/**
 * The deploy driver as an ahpd plugin (#38276 slice 2, @cto d9b6519a and 2026-11-25): a machine's services, at a
 * version, told from elsewhere.
 *
 * Two methods, and the split is a fact about time rather than taste: a deploy runs minutes (a fetch, a build, a
 * check) while an AHP host request is capped at HOST_LOCAL_TIMEOUT_MS (9 s). So `run` checks, starts and answers
 * `started <deployId>` at once; `report` reads the journal, so the outcome comes back to the person who asked.
 *
 * The deploy never runs in ahpd's event loop (@cto 2026-11-25): `run` spawns `ahpd deploy` as a detached child in
 * its own process group, because a step of minutes inside the daemon would block every other host request. What is
 * decided before answering is what can be decided cheaply and truthfully - another deploy running, an unknown
 * service, a version the declared ref cannot reach, and the machine's own gate over build and hook commands.
 *
 * The gate is `@ahpd/services`' `machineSwitches`, read fresh on every call: one reader for `allowRemoteCommands`,
 * never a copy here, and a throw is a refusal with its own sentence rather than a quiet "off".
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listServices, machineOf, machineSwitches, REMOTE_COMMANDS_OFF, type Machine, type MachineSwitches } from '@ahpd/services';
import { readJournal, resolveVersion, status, writeJournalEntry } from './index.js';
import type { DeployCommand, DeployDeclaration, DeployLayout } from './index.js';

/** The plugin's id. */
export const name = 'deploy';

/** What a listing prints. */
export const title = 'Deploy';

/** The method names, as the manifest's `contracts.methods` lists them. */
export const METHODS = ['x-ahpd/deploy/run', 'x-ahpd/deploy/report'];

/** Why a call was refused, so a person reads a sentence rather than an empty answer. */
export type DeployRefusalCode =
  | 'INVALID'
  | 'RUNNING'
  | 'UNKNOWN_SERVICE'
  | 'UNREACHABLE'
  | 'NOT_ALLOWED'
  | 'NOT_CONFIGURED'
  | 'DRIVER_FAILED';

export interface DeployRefusal {
  readonly ok: false;
  readonly code: DeployRefusalCode;
  readonly message: string;
}

/** A method as the host serves it: the members of the sdk's `PluginMethod` this uses. */
export interface DeployMethod {
  readonly grant: `${string}:${string}`;
  describe(): { title: string; description?: string };
  handle(params: Record<string, unknown>, reader: { readonly id: string } | undefined, client: string, owner?: string): Promise<unknown>;
}

/** The members of the sdk's `PluginHost` this plugin uses. */
export interface DeployHost {
  readonly configDir: string;
  registerMethod(name: string, method: DeployMethod): void;
  registerGrants(subject: string, entry: { title?: string; description?: string; operations: string[] }): void;
  alert(alert: { level: 'error' | 'warning' | 'info'; text: string; ref: string }): void;
}

/** One deploy as the method accepted it, and as the child is given it. */
export interface DeployRequest {
  readonly service: string;
  readonly version: string;
  readonly declaration: DeployDeclaration;
  readonly deployId: string;
}

/** What a started child tells the method: when it ended, and how. */
export interface StartedDeploy {
  readonly whenExited?: Promise<number | null>;
}

/** Starts one accepted deploy; `ahpd deploy` as a detached child by default. */
export type StartDeploy = (request: DeployRequest) => StartedDeploy | void;

export interface DeployMethodsOptions {
  /** Where a service's deploy state sits: the host's configuration directory. */
  readonly stateDir: string;
  /** The machine's own switches, read on every call. */
  readonly switches: () => MachineSwitches;
  /** Every service this machine runs, by name, for the "unknown service" check. */
  readonly services: () => readonly string[] | Promise<readonly string[]>;
  /** How the steps start once the checks pass; `ahpd deploy` as a detached child by default. */
  readonly start: StartDeploy;
  /** How long to wait for the child to take the lock before answering that it did not. */
  readonly waitForLockMs?: number;
}

/** How long a run waits for its child to hold the lock, inside the 9 s a host request has (@cto 2026-11-25). */
export const WAIT_FOR_LOCK_MS = 5_000;

const refused = (code: DeployRefusalCode, message: string): DeployRefusal => ({ ok: false, code, message });

/** The words a caller may send, and no others: a misspelt key is refused by name rather than ignored. */
const RUN_KEYS = ['service', 'version', 'repo', 'ref', 'migrations', 'build', 'before_switch', 'check', 'keep'] as const;

const commandOf = (value: unknown, key: string): DeployCommand | DeployRefusal => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refused('INVALID', `${key} is an object { command, args?, env?, timeoutMs? }, not ${Array.isArray(value) ? 'a list' : typeof value}`);
  }
  const fields = value as Record<string, unknown>;
  const extra = Object.keys(fields).filter((one) => !['command', 'args', 'env', 'timeoutMs'].includes(one));
  if (extra.length > 0) return refused('INVALID', `${key} has unknown ${extra.join(', ')}`);
  const command = fields['command'];
  if (typeof command !== 'string' || command.trim() === '') return refused('INVALID', `${key}.command is a non-empty string`);
  const args = fields['args'];
  if (args !== undefined && (!Array.isArray(args) || args.some((one) => typeof one !== 'string'))) return refused('INVALID', `${key}.args is a list of strings`);
  const timeoutMs = fields['timeoutMs'];
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1)) return refused('INVALID', `${key}.timeoutMs is a whole number of milliseconds`);
  // A value is only ever a reference; a plain value here would put a secret in the protocol and then in a journal.
  const env = fields['env'];
  const read: Record<string, { $secret: string }> = {};
  if (env !== undefined) {
    if (typeof env !== 'object' || env === null || Array.isArray(env)) return refused('INVALID', `${key}.env is an object of NAME: { $secret: "<scope>:<name>" }`);
    for (const [variable, held] of Object.entries(env as Record<string, unknown>)) {
      const reference = typeof held === 'object' && held !== null && !Array.isArray(held) ? (held as Record<string, unknown>)['$secret'] : undefined;
      if (typeof reference !== 'string' || reference === '' || Object.keys(held as object).length !== 1) {
        return refused('INVALID', `${key}.env ${variable} must be a secret reference {"$secret":"<scope>:<name>"}; a plain value never crosses this method`);
      }
      read[variable] = { $secret: reference };
    }
  }
  return {
    command,
    ...(args === undefined ? {} : { args: args as string[] }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(env === undefined ? {} : { env: read }),
  };
};

/** The declaration a run's params carry, or the refusal that names the first bad field. */
const declarationOf = (params: Record<string, unknown>): DeployDeclaration | DeployRefusal => {
  const repo = params['repo'];
  if (typeof repo !== 'string' || repo.trim() === '') return refused('INVALID', 'repo is the repository the version is fetched from: a path or a URL git can fetch');
  const ref = params['ref'] ?? 'main';
  if (typeof ref !== 'string' || ref.trim() === '') return refused('INVALID', 'ref is a non-empty ref name');
  const migrations = params['migrations'];
  if (migrations !== undefined && migrations !== 'expand-only') return refused('INVALID', `deploy knows one migration value, expand-only; it was given ${String(migrations)}`);
  const keep = params['keep'];
  if (keep !== undefined && (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 2 || keep > 60)) return refused('INVALID', 'keep is a whole number of release folders from 2 to 60: one kept release is a folder with no way back');
  const declaration: DeployDeclaration = { repo, ref, ...(migrations === undefined ? {} : { migrations: 'expand-only' as const }), ...(keep === undefined ? {} : { keep }) };
  const commands = { build: 'build', before_switch: 'beforeSwitch', check: 'check' } as const;
  for (const [key, field] of Object.entries(commands)) {
    const value = params[key];
    if (value === undefined) continue;
    const read = commandOf(value, key);
    if ('ok' in read) return read;
    Object.assign(declaration, { [field]: read });
  }
  return declaration;
};

/**
 * Whether this machine takes a deploy from outside it at all.
 *
 * The switch is `allowRemoteCommands`, the same one the services driver reads: a deploy is a command from Hightea
 * even when the declaration names no build or hook, because it puts another version live.
 */
const gateRefusal = (switches: MachineSwitches): string | undefined =>
  switches.allowRemoteCommands ? undefined : REMOTE_COMMANDS_OFF;

/** The two methods over one machine's deploy state. */
export function deployMethods(options: DeployMethodsOptions): Record<string, DeployMethod> {
  const stateOf = (service: string): DeployLayout => ({ stateDir: options.stateDir, service });
  return {
    'x-ahpd/deploy/run': {
      grant: 'deploy:run',
      describe: () => ({ title: 'Deploy a service', description: 'Places one of this machine\'s services at a version: fetches, builds, switches one symlink, checks. Answers started <deployId>; the report says what happened.' }),
      handle: async (params) => {
        const unknown = Object.keys(params).filter((key) => !(RUN_KEYS as readonly string[]).includes(key));
        if (unknown.length > 0) return refused('INVALID', `run has no ${unknown.join(', ')}; it takes ${RUN_KEYS.join(', ')}`);
        const service = params['service'];
        if (typeof service !== 'string' || service.trim() === '') return refused('INVALID', 'service is a non-empty name');
        const version = params['version'];
        if (typeof version !== 'string' || version.trim() === '') return refused('INVALID', 'version is a branch, a tag or a commit sha');
        const declaration = declarationOf(params);
        if ('ok' in declaration) return declaration;

        // The machine's own switches first: a throw here is a refusal with its sentence, never read as "off".
        let switches: MachineSwitches;
        try {
          switches = options.switches();
        } catch (error) {
          return refused('NOT_CONFIGURED', error instanceof Error ? error.message : String(error));
        }

        let services: readonly string[];
        try {
          services = await options.services();
        } catch (error) {
          return refused('NOT_CONFIGURED', `cannot read this machine's services: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!services.includes(service)) {
          return refused('UNKNOWN_SERVICE', `this machine runs no service called ${service}; it has ${services.length === 0 ? 'none' : services.join(', ')}`);
        }

        const why = gateRefusal(switches);
        if (why !== undefined) return refused('NOT_ALLOWED', why);

        const layout = stateOf(service);
        const running = status(layout).lock;
        if (running !== undefined) {
          // A lock whose process is gone is not "running": the child will answer `outcome unknown` by name instead.
          return refused('RUNNING', `a deploy of ${service} is already running (${running.deployId})`);
        }

        let sha: string;
        try {
          sha = resolveVersion(layout, declaration, version);
        } catch (error) {
          return refused('UNREACHABLE', error instanceof Error ? error.message : String(error));
        }

        const request: DeployRequest = { service, version: sha, declaration, deployId: randomUUID() };
        let started: StartedDeploy | void;
        try {
          started = options.start(request);
        } catch (error) {
          return refused('DRIVER_FAILED', `the deploy of ${service} could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Answering before the child holds the lock would let two calls both say started and one of them be false:
        // the loser refuses in its child and the person was told a deploy began that never did (@cto 2026-11-25).
        let exited: number | null | undefined;
        const ending = started?.whenExited?.then((code) => { exited = code; });
        const budget = options.waitForLockMs ?? WAIT_FOR_LOCK_MS;
        const deadline = Date.now() + budget;
        for (;;) {
          const held = status(layout).lock;
          if (held !== undefined) {
            if (held.deployId === request.deployId) return { ok: true, service, sha, deployId: request.deployId, state: 'started' };
            return refused('RUNNING', `a deploy of ${service} is already running (${held.deployId})`);
          }
          // A tick between checks, or the child's end when there is one to watch: racing against an absent promise
          // would resolve at once and spin here, starving the child that is meant to take the lock.
          const tick = new Promise((resolve) => setTimeout(resolve, 25));
          await (ending === undefined ? tick : Promise.race([tick, ending]));
          if (exited !== undefined) {
            return refused('DRIVER_FAILED', `the deploy of ${service} stopped before taking the lock (exit ${exited === null ? 'by signal' : String(exited)})`);
          }
          if (Date.now() >= deadline) {
            writeJournalEntry(layout, { event: 'not started', deployId: request.deployId, reason: `the deploy child did not take the lock in ${String(budget)} ms` });
            return refused('DRIVER_FAILED', `the deploy child did not take the lock in ${String(budget)} ms`);
          }
        }
      },
    },
    'x-ahpd/deploy/report': {
      grant: 'deploy:read',
      describe: () => ({ title: 'Read a deploy report', description: 'The release current points at, the deploy still running if one is, and the last journal line - which is the outcome of the last deploy, with its steps, exit codes and timings.' }),
      handle: async (params) => {
        const unknown = Object.keys(params).filter((key) => key !== 'service');
        if (unknown.length > 0) return refused('INVALID', `report has no ${unknown.join(', ')}; it takes service`);
        const service = params['service'];
        if (typeof service !== 'string' || service.trim() === '') return refused('INVALID', 'service is a non-empty name');
        const layout = stateOf(service);
        const read = status(layout);
        const last = readJournal(layout).at(-1);
        return {
          ok: true,
          service,
          current: read.current,
          running: read.lock === undefined ? null : { deployId: read.lock.deployId, step: read.lock.step },
          last: last ?? null,
          // Never deployed on this machine is a fact to say, not an empty answer to interpret.
          deployed: read.current !== null || last !== undefined,
        };
      },
    },
  };
}

/** The file a started deploy's request is handed to the child through: one place, one shape, never argv. */
export const REQUEST_FILE = 'request.json';

/** A request as the child reads it back. */
export interface HandedRequest {
  readonly deployId: string;
  readonly declaration: DeployDeclaration;
}

export const apply = (host: DeployHost, options: Record<string, unknown>): void => {
  host.registerGrants('deploy', {
    title: 'Deploy',
    description: 'Placing this machine\'s services at a version, and reading what the last deploy did.',
    operations: ['run', 'read'],
  });
  const read = machineOf(host.configDir, options);
  if (typeof read === 'string') {
    // Loud and in place, as the services plugin does: the plugin's page says what is wrong.
    host.alert({ level: 'error', text: read, ref: 'deploy-options' });
    for (const method of METHODS) {
      host.registerMethod(method, { grant: 'deploy:read', describe: () => ({ title: method }), handle: async () => refused('NOT_CONFIGURED', read) });
    }
    return;
  }
  const { machine } = read;
  const stateDir = typeof options['stateDir'] === 'string' ? options['stateDir'] : host.configDir;
  const methods = deployMethods({
    stateDir,
    switches: () => machineSwitches(host.configDir),
    services: () => {
      const listing = listServices(machine);
      // A listing that cannot be read is a refusal with its own sentence, never an empty list that reads as "none".
      if (!listing.ok) throw new Error(listing.message);
      return listing.services.map((one) => one.name);
    },
    start: (request) => startChild(machine, stateDir, request),
  });
  for (const method of METHODS) {
    const found = methods[method];
    if (found === undefined) continue;
    host.registerMethod(method, found);
  }
};

/**
 * Starts `ahpd deploy` in its own process group, with the request written beside the service's state.
 *
 * The child is given one file rather than a line of flags: a build command arrives as a program and its arguments,
 * and rebuilding a shell line from that to re-split in the child is where a quoting bug would live.
 */
export function startChild(machine: Machine, stateDir: string, request: DeployRequest): StartedDeploy {
  const root = join(stateDir, 'deploy', request.service);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = join(root, REQUEST_FILE);
  const handed: HandedRequest = { deployId: request.deployId, declaration: request.declaration };
  writeFileSync(file, `${JSON.stringify(handed, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1] ?? '', 'deploy', request.service, request.version, '--request', file], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...(machine.name === '' ? {} : { AHPD_MACHINE: machine.name }) },
  });
  child.unref();
  return { whenExited: new Promise<number | null>((resolve) => { child.on('exit', (code) => { resolve(code); }); }) };
}
