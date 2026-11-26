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
 * The gate is `@hallohuman/hightea-services`' `machineSwitches`, read fresh on every call: one reader for `allowRemoteCommands`,
 * never a copy here, and a throw is a refusal with its own sentence rather than a quiet "off".
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listServices, machineOf, machineSwitches, REMOTE_COMMANDS_OFF, type Machine, type MachineSwitches } from '@hallohuman/hightea-services';
import { readJournal, resolveVersion, status, writeJournalEntry } from './index.js';
import type { DeployDeclaration, DeployLayout } from './index.js';
import { CHANGED, CHANNEL, OPERATION, READS_SCHEME, SCHEME, deploysChannel, deploysProvider, deploysState, refusalError, type DeploysState } from './channel.js';

/** The plugin's id. */
export const name = 'deploy';

/** What a listing prints. */
export const title = 'Deploy';

/** The release that replaced the two methods with the channel: what a refusal of an old call names. */
export const REPLACED_IN = '@ahpd/deploy 0.16.0';

/** The methods this plugin served before the channel, by what replaced each (@cto 2026-11-25). */
export const RETIRED: Readonly<Record<string, string>> = {
  'x-ahpd/deploy/run': `the deploy operation on ${CHANNEL}`,
  'x-ahpd/deploy/report': `a subscribe to ${CHANNEL} and ${READS_SCHEME}://<deployId>/log`,
};

/** Every retired method, in the one list a host registration loops over. */
export const METHODS = Object.keys(RETIRED);

/** Why a call was refused, so a person reads a sentence rather than an empty answer. */
export type DeployRefusalCode =
  | 'INVALID'
  | 'NO_DEPLOY_DECLARATION'
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
  registerChannel(scheme: string, channel: unknown): DeployChannelHandle;
  registerResourceProvider(scheme: string, provider: unknown): void;
  alert(alert: { level: 'error' | 'warning' | 'info'; text: string; ref: string }): void;
}

/** What `registerChannel` answers: the members of the sdk's `ChannelHandle` this uses. */
export interface DeployChannelHandle {
  publish(uri: string, action: { type: string } & Record<string, unknown>): void;
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
  /** Stops the child and everything it started: the process group it leads. */
  readonly killGroup?: () => void;
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
  /**
   * One service's deploy declaration, read from its own record (#38549), or the
   * refusal that says why the record carries none. Never a default: a missing
   * repository is the machine's answer, not ours.
   */
  readonly declaration: (service: string) => DeployDeclaration | DeployRefusal | Promise<DeployDeclaration | DeployRefusal>;
  /** How the steps start once the checks pass; `ahpd deploy` as a detached child by default. */
  readonly start: StartDeploy;
  /** How long to wait for the child to take the lock before answering that it did not. */
  readonly waitForLockMs?: number;
}

/** How long a run waits for its child to hold the lock, inside the 9 s a host request has (@cto 2026-11-25). */
export const WAIT_FOR_LOCK_MS = 5_000;

const refused = (code: DeployRefusalCode, message: string): DeployRefusal => ({ ok: false, code, message });

/**
 * The words a caller may send, and no others: a misspelt key is refused by name
 * rather than ignored. #38549 (@cto 2026-11-25): the declaration fields moved
 * onto the service's own record, so a caller chooses a service and a version
 * and never a command.
 */
const RUN_KEYS = ['service', 'version'] as const;

/**
 * Whether this machine takes a deploy from outside it at all.
 *
 * The switch is `allowRemoteCommands`, the same one the services driver reads: a deploy is a command from Hightea
 * even when the declaration names no build or hook, because it puts another version live.
 */
const gateRefusal = (switches: MachineSwitches): string | undefined =>
  switches.allowRemoteCommands ? undefined : REMOTE_COMMANDS_OFF;

/** The two methods over one machine's deploy state. */
export function deployMethods(options: DeployMethodsOptions): { run: DeployMethod; report: DeployMethod } {
  const stateOf = (service: string): DeployLayout => ({ stateDir: options.stateDir, service });
  return {
    run: {
      grant: 'deploy:run',
      describe: () => ({ title: 'Deploy a service', description: 'Places one of this machine\'s services at a version: fetches, builds, switches one symlink, checks. Answers started <deployId>; the report says what happened.' }),
      handle: async (params) => {
        const unknown = Object.keys(params).filter((key) => !(RUN_KEYS as readonly string[]).includes(key));
        if (unknown.length > 0) return refused('INVALID', `run has no ${unknown.join(', ')}; it takes ${RUN_KEYS.join(', ')}`);
        const service = params['service'];
        if (typeof service !== 'string' || service.trim() === '') return refused('INVALID', 'service is a non-empty name');
        const version = params['version'];
        if (typeof version !== 'string' || version.trim() === '') return refused('INVALID', 'version is a branch, a tag or a commit sha');
        let declaration: DeployDeclaration | DeployRefusal;
        try {
          declaration = await options.declaration(service);
        } catch (error) {
          return refused('NOT_CONFIGURED', `this machine's record of ${service} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        }
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
            // Stop the child before answering: one that takes the lock after this answer would deploy behind a caller
            // that was told the deploy never began, so the refusal is made true rather than merely early.
            try {
              started?.killGroup?.();
            } catch (error) {
              const why = error instanceof Error ? error.message : String(error);
              writeJournalEntry(layout, { event: 'not started', deployId: request.deployId, reason: `did not take the lock in ${String(budget)} ms and was not stopped: ${why}` });
              return refused('DRIVER_FAILED', `the deploy child did not take the lock in ${String(budget)} ms and could not be stopped: ${why}`);
            }
            // The kill is not instant, so the child may have taken the lock between the last check and the signal.
            // Re-read it before answering: "without taking the lock" must never sit in the journal beside a lock
            // naming this deploy (@cto 2026-11-25). A lock found here is stale, and the next deploy clears it
            // through the pid-and-start-time check, so it is named and left, never resumed.
            const after = status(layout).lock;
            if (after !== undefined && after.deployId === request.deployId) {
              // 'outcome unknown', not 'not started': a child that held the lock may have run a step before the
              // signal reached it, and the journal says the step it had reached rather than claiming it never began.
              writeJournalEntry(layout, { event: 'outcome unknown', deployId: request.deployId, step: after.step, reason: 'killed after taking the lock; the lock it left is stale and the next deploy clears it' });
              return refused('DRIVER_FAILED', `the deploy child was killed after taking the lock at step ${after.step}; its lock is stale and the next deploy clears it`);
            }
            writeJournalEntry(layout, { event: 'not started', deployId: request.deployId, reason: `killed after ${String(budget)} ms without taking the lock` });
            return refused('DRIVER_FAILED', `the deploy child was killed after ${String(budget)} ms without taking the lock`);
          }
        }
      },
    },
    report: {
      grant: 'deploy:status',
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

/** An old method's answer: refused, naming what replaced it and in which release, never a bare method-not-found. */
const retiredMethod = (method: string, why: string): DeployMethod => ({
  grant: 'deploy:status',
  describe: () => ({ title: `${method} (replaced)`, description: `Replaced by ${RETIRED[method]} in ${REPLACED_IN}.` }),
  handle: async () => {
    throw Object.assign(new Error(`${method} was replaced by ${RETIRED[method]} in ${REPLACED_IN}; update the caller to a release that uses it`), {
      name: 'RpcError',
      code: -32601,
      data: { replacedBy: RETIRED[method], release: REPLACED_IN, why },
    });
  },
});

export const apply = (host: DeployHost, options: Record<string, unknown>): void => {
  host.registerGrants('deploy', {
    title: 'Deploy',
    description: 'Placing this machine\'s services at a version, and reading what each deploy did.',
    operations: ['deploy', 'status'],
  });
  const stateDir = typeof options['stateDir'] === 'string' ? options['stateDir'] : host.configDir;
  const layout = (service: string): DeployLayout => ({ stateDir, service });
  const read = machineOf(host.configDir, options);

  if (typeof read === 'string') {
    // Loud and in place, as the services plugin does: the plugin's page says what is wrong, and the channel still
    // answers with that sentence rather than vanishing.
    host.alert({ level: 'error', text: read, ref: 'deploy-options' });
    const why = read;
    const context = {
      machine: 'this machine',
      services: (): readonly string[] => [],
      layout,
      state: () => ({ machine: 'this machine', runs: [], operations: [OPERATION], error: why }),
      deploy: async (): Promise<unknown> => { throw refusalError(refused('NOT_CONFIGURED', why)); },
    };
    host.registerChannel(SCHEME, deploysChannel(context));
    host.registerResourceProvider(READS_SCHEME, deploysProvider(context));
    for (const method of METHODS) host.registerMethod(method, retiredMethod(method, why));
    return;
  }

  const { machine } = read;
  const servicesNow = (): readonly string[] => {
    const listing = listServices(machine);
    // A listing that cannot be read is a refusal with its own sentence, never an empty list that reads as "none".
    if (!listing.ok) throw new Error(listing.message);
    return listing.services.map((one) => one.name);
  };
  // #38549: the declaration is the service's own record, mapped from its neutral step names to this package's.
  const declarationNow = (service: string): DeployDeclaration | DeployRefusal => {
    const listing = listServices(machine);
    if (!listing.ok) return refused('NOT_CONFIGURED', `this machine's services could not be read: ${listing.message}`);
    const record = listing.services.find((one) => one.name === service);
    if (record === undefined) return refused('UNKNOWN_SERVICE', `this machine runs no service called ${service}`);
    const held = record.deploy;
    if (held === undefined) {
      return refused('NO_DEPLOY_DECLARATION', `${service} carries no deploy declaration: its record must name deploy.repo, deploy.ref and any steps (build, before_switch, check) before it can be deployed from elsewhere`);
    }
    return {
      repo: held.repo,
      ref: held.ref,
      ...(held.migrations === undefined ? {} : { migrations: held.migrations }),
      ...(held.keep === undefined ? {} : { keep: held.keep }),
      ...(held.build === undefined ? {} : { build: held.build }),
      ...(held.before_switch === undefined ? {} : { beforeSwitch: held.before_switch }),
      ...(held.check === undefined ? {} : { check: held.check }),
    };
  };
  let handle: DeployChannelHandle | undefined;
  // An unreadable services listing is this channel's own sentence, never a throw out of a snapshot: the services
  // plugin's shape, so a wrong `files` path or a missing socket leaves the rest of the daemon serving (@dev/14).
  const stateNow = (): DeploysState => {
    try {
      return deploysState(machine.name, servicesNow(), layout);
    } catch (error) {
      return { machine: machine.name, runs: [], operations: [OPERATION], error: `this machine's services could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  };
  // A state that cannot be published is said out loud, once per failure: a quiet channel is the failure this exists for.
  const publishState = (): void => {
    try {
      handle?.publish(CHANNEL, { type: CHANGED, ...stateNow() });
    } catch (error) {
      host.alert({ level: 'warning', text: `the deploy channel could not publish its new state: ${error instanceof Error ? error.message : String(error)}`, ref: 'deploy-publish' });
    }
  };

  const methods = deployMethods({
    stateDir,
    switches: () => machineSwitches(host.configDir),
    services: servicesNow,
    declaration: declarationNow,
    start: (request) => {
      const started = startChild(machine, stateDir, request);
      // The child's end is the next honest state: the row goes from running to whatever its journal says last.
      void started.whenExited?.then(() => { publishState(); });
      return started;
    },
  });

  const context = {
    machine: machine.name,
    services: servicesNow,
    layout,
    state: stateNow,
    deploy: async (input: Record<string, unknown>, caller: { readonly client: string; readonly owner?: string }): Promise<unknown> => {
      const answer = await methods.run.handle(input, undefined, caller.client, caller.owner) as Record<string, unknown> & { ok?: boolean; code?: string; message?: string };
      if (answer['ok'] === false) throw refusalError({ code: String(answer['code'] ?? 'DRIVER_FAILED'), message: String(answer['message'] ?? 'the deploy was refused') });
      publishState();
      return answer;
    },
  };
  handle = host.registerChannel(SCHEME, deploysChannel(context));
  host.registerResourceProvider(READS_SCHEME, deploysProvider(context));
  for (const method of METHODS) host.registerMethod(method, retiredMethod(method, 'the deploy channel replaced it'));
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
  const pid = child.pid;
  return {
    whenExited: new Promise<number | null>((resolve) => { child.on('exit', (code) => { resolve(code); }); }),
    // A child that outlived the lock wait can still take the lock afterwards, which would make a refusal that said
    // the deploy never began false (@cto 2026-11-25). It leads its own group, so the whole group is what stops.
    killGroup: () => {
      if (pid === undefined) throw new Error('the deploy child was never given a pid');
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        // Already gone is the outcome this call wants; anything else is a child that may still deploy.
        if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH')) throw error;
      }
    },
  };
}
