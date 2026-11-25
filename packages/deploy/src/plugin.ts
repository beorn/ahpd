/**
 * The deploy driver as an ahpd plugin (#38276 slice 2, @cto d9b6519a): a machine's services, at a version, told from
 * elsewhere.
 *
 * Two methods, and the split is forced by time rather than taste: a deploy runs minutes (a fetch, a build, a check)
 * while an AHP host request is capped at HOST_LOCAL_TIMEOUT_MS (9 s). So `run` takes the service's lock, starts the
 * steps and answers `started <deployId>` at once — taking the lock first is what makes that answer true, because a
 * second call in the same second is refused by the running deploy's id exactly as the whole-call path refuses it.
 * `report` reads the journal, so the outcome comes back to the person who asked without a second deploy.
 *
 * The machine's gate over a build, hook or check command is injected, never read here: `allowRemoteCommands` has one
 * reader (#38277, `@ahpd/services`' `machineSwitches`) and a second copy in this package would be the one that drifts.
 * Without a gate the plugin registers methods that refuse by name, so an unwired plugin cannot run a command.
 */
import { claim, deploy, readJournal, status } from './index.js';
import type { DeployCommand, DeployDeclaration, DeployLayout, DeployLock, DeployOptions, DeployStep } from './index.js';

/** The plugin's id. */
export const name = 'deploy';

/** What a listing prints. */
export const title = 'Deploy';

/** The method names, as the manifest's `contracts.methods` lists them. */
export const METHODS = ['x-ahpd/deploy/run', 'x-ahpd/deploy/report'];

/** Why a call was refused, so a person reads a sentence rather than an empty answer. */
export type DeployRefusalCode = 'INVALID' | 'RUNNING' | 'OUTCOME_UNKNOWN' | 'NOT_DEPLOYED' | 'NOT_CONFIGURED' | 'DRIVER_FAILED';

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

/** What the machine answers a command with: why it may not run, or `undefined` when it may. */
export type Permit = (step: DeployStep, command: DeployCommand) => string | undefined;

export interface DeployMethodsOptions {
  /** The gate over every command a deploy would run. Required: a plugin that runs an ungated command is not built. */
  readonly permit: Permit;
  /** Where a service's deploy state sits: the host's configuration directory. */
  readonly stateDir: string;
  /** Starts the steps once the lock is taken; injected so a test sees what the method handed it without running git. */
  readonly start?: (options: DeployOptions) => void;
}

const refused = (code: DeployRefusalCode, message: string): DeployRefusal => ({ ok: false, code, message });

/** The words a caller may send, and no others: a misspelt key is refused by name rather than ignored. */
const RUN_KEYS = ['service', 'version', 'repo', 'ref', 'migrations', 'build', 'before_switch', 'check', 'keep'] as const;

const commandOf = (value: unknown, key: string): DeployCommand | DeployRefusal => {
  if (value === undefined) return refused('INVALID', `${key} is absent`);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refused('INVALID', `${key} is an object { command, args? }, not ${Array.isArray(value) ? 'a list' : typeof value}`);
  const fields = value as Record<string, unknown>;
  const extra = Object.keys(fields).filter((one) => one !== 'command' && one !== 'args');
  if (extra.length > 0) return refused('INVALID', `${key} has unknown ${extra.join(', ')}`);
  const command = fields['command'];
  if (typeof command !== 'string' || command.trim() === '') return refused('INVALID', `${key}.command is a non-empty string`);
  const args = fields['args'];
  if (args !== undefined && (!Array.isArray(args) || args.some((one) => typeof one !== 'string'))) return refused('INVALID', `${key}.args is a list of strings`);
  return { command, ...(args === undefined ? {} : { args: args as string[] }) };
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
  if (keep !== undefined && (typeof keep !== 'number' || !Number.isInteger(keep) || keep < 1 || keep > 60)) return refused('INVALID', 'keep is a whole number of release folders from 1 to 60');
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

/** The two methods over one machine's deploy state. */
export function deployMethods(options: DeployMethodsOptions): Record<string, DeployMethod> {
  const stateOf = (service: string): DeployLayout => ({ stateDir: options.stateDir, service });
  const start = options.start ?? ((going: DeployOptions): void => {
    setImmediate(() => {
      try {
        // The result is already in the journal, which is what `report` reads; nothing here can throw into ahpd.
        deploy(going);
      } catch {
        // A resolve that throws journals `failed` under its own step before rethrowing; the journal is the record.
      }
    });
  });
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
        const layout = stateOf(service);
        const taken = claim(layout);
        if (!taken.ok) {
          const outcome = taken.result.outcome;
          if (outcome.state === 'refused, deploy running') {
            return refused('RUNNING', `a deploy of ${service} is already running (${outcome.deployId})`);
          }
          if (outcome.state === 'outcome unknown') {
            return refused('OUTCOME_UNKNOWN', `an earlier deploy of ${service} left ${outcome.step} unfinished (${outcome.deployId}); its outcome is unknown and it is never resumed`);
          }
          return refused('DRIVER_FAILED', `the deploy of ${service} could not start: ${outcome.state}`);
        }
        const going: DeployOptions = { ...layout, version, declaration, claimed: taken.lock, permit: options.permit };
        try {
          start(going);
        } catch (error) {
          return refused('DRIVER_FAILED', `the deploy of ${service} could not start: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { ok: true, service, deployId: taken.lock.deployId, state: 'started' };
      },
    },
    'x-ahpd/deploy/report': {
      grant: 'deploy:list',
      describe: () => ({ title: 'Read a deploy report', description: 'The release current points at, the deploy still running if one is, and the last line the journal wrote - which is the outcome of the last deploy.' }),
      handle: async (params) => {
        const unknown = Object.keys(params).filter((key) => key !== 'service');
        if (unknown.length > 0) return refused('INVALID', `report has no ${unknown.join(', ')}; it takes service`);
        const service = params['service'];
        if (typeof service !== 'string' || service.trim() === '') return refused('INVALID', 'service is a non-empty name');
        const layout = stateOf(service);
        const read = status(layout);
        const last = readJournal(layout).at(-1);
        const running: DeployLock | undefined = read.lock;
        return {
          ok: true,
          service,
          current: read.current,
          running: running === undefined ? null : { deployId: running.deployId, step: running.step },
          last: last ?? null,
          // Never deployed on this machine is a fact to say, not an empty answer to interpret.
          deployed: read.current !== null || last !== undefined,
        };
      },
    },
  };
}

export const apply = (host: DeployHost, options: Record<string, unknown>): void => {
  host.registerGrants('deploy', {
    title: 'Deploy',
    description: 'Placing this machine\'s services at a version, and reading what the last deploy did.',
    operations: ['run', 'read'],
  });
  const permit = options['permit'];
  if (typeof permit !== 'function') {
    const message = 'the deploy plugin needs this machine\'s command gate (allowRemoteCommands); it is wired from @ahpd/services\' machineSwitches (#38277), and until then it runs nothing';
    host.alert({ level: 'error', text: message, ref: 'deploy-gate' });
    for (const method of METHODS) {
      host.registerMethod(method, { grant: 'deploy:list', describe: () => ({ title: method }), handle: async () => refused('NOT_CONFIGURED', message) });
    }
    return;
  }
  const stateDir = typeof options['stateDir'] === 'string' ? options['stateDir'] : host.configDir;
  const methods = deployMethods({ permit: permit as Permit, stateDir });
  for (const method of METHODS) {
    const found = methods[method];
    if (found === undefined) continue;
    host.registerMethod(method, found);
  }
};
