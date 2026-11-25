/**
 * The services driver as an ahpd plugin (#38277 slice 2, @cto).
 *
 * It serves the driver as nine `x-ahpd/services/*` methods (ahpd requires the
 * `x-` prefix; `service` alone would read as `ahpd service install`, which is
 * the daemon's own unit), registers the `services` grants a role is given them
 * by, and runs the drift check at start and every five minutes.
 *
 * Who is asking: a method's handler is told the caller's principal, the
 * client id it gave at `initialize`, and the owner of its work - nothing about
 * the socket it came in on. A root connection's token, a person's key and the
 * Hightea pipe plugin (`plugin:hightea-pipe`, a local process relaying a
 * remote person) are all accepted from anywhere the daemon listens, so the
 * handler cannot tell a person at this machine from one elsewhere. Every
 * caller is therefore remote (the safe side, @cto): with `allowRemoteCommands`
 * off, a new command is written by editing the file on the machine.
 *
 * The package imports nothing of `@ahpd/sdk`: the host is read through the
 * few members named below, which the daemon's `PluginHost` has, and a test
 * checks that the shapes agree.
 */
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import {
  acknowledgeFiles, backupServices, controlService, listServices, putService, removeService, serviceLogs,
  type AcknowledgeParams, type Answer, type BackupParams, type Caller, type Machine, type PutParams, type Refusal,
} from './compose.js';
import { DRIFT_REF, acknowledge, checkDrift, type DriftAlert } from './drift.js';

/** The plugin's id. */
export const name = 'services';

/** What a listing prints. */
export const title = 'Services';

/** How often drift is checked, after the check at start. */
export const DRIFT_EVERY_MS = 5 * 60 * 1000;

/** A method as the host serves it: the members of the sdk's `PluginMethod` this uses. */
export interface ServicesMethod {
  readonly grant: `${string}:${string}`;
  describe(): { title: string; description?: string };
  handle(params: Record<string, unknown>, reader: { readonly id: string } | undefined, client: string, owner?: string): Promise<unknown>;
}

/** The members of the sdk's `PluginHost` this plugin uses. */
export interface ServicesHost {
  readonly configDir: string;
  registerMethod(name: string, method: ServicesMethod): void;
  registerGrants(subject: string, entry: { title?: string; description?: string; operations: string[] }): void;
  registerClose(close: () => void | Promise<void>): void;
  alert(alert: DriftAlert): void;
  clearAlert(ref: string): void;
}

/** The driver's functions, by verb; a test passes its own to see what each method calls. */
export interface Driver {
  readonly list: typeof listServices;
  readonly put: typeof putService;
  readonly remove: typeof removeService;
  readonly control: typeof controlService;
  readonly logs: typeof serviceLogs;
  readonly acknowledge: typeof acknowledgeFiles;
  readonly backup: typeof backupServices;
}

export const DRIVER: Driver = {
  list: listServices, put: putService, remove: removeService, control: controlService, logs: serviceLogs, acknowledge: acknowledgeFiles,
  backup: backupServices,
};

/** The method names, as the manifest's `contracts.methods` lists them. */
export const METHODS = ['list', 'put', 'remove', 'start', 'stop', 'restart', 'logs', 'acknowledge', 'backup'].map((verb) => `x-ahpd/services/${verb}`);

/**
 * Who a call is from, for the change log and the `allowRemoteCommands` check.
 * The owner the host recorded first, then the principal, then the client id
 * the connection gave; always remote, because nothing here can tell otherwise.
 */
export const callerOf = (reader: { readonly id: string } | undefined, client: string, owner: string | undefined): Caller => ({
  principal: owner ?? (reader === undefined ? `client:${client}` : `user:${reader.id}`),
  remote: true,
});

/** Whatever a handler meets is answered as a refusal, never thrown into ahpd. */
const guarded = async (run: () => Promise<unknown> | unknown): Promise<unknown> => {
  try {
    return await run();
  }
  catch (error) {
    return { ok: false, code: 'DRIVER_FAILED', message: `services driver failed: ${error instanceof Error ? error.message : String(error)}` } satisfies Refusal;
  }
};

/**
 * The nine methods over one machine. `wrote` is told the file and its new
 * hash after each put or remove that wrote, and each file an acknowledge
 * accepted, so drift takes it as known; `acknowledged` runs after an accepted
 * acknowledge, so the plugin can check drift again at once rather than in five
 * minutes. Each method answers the driver's answer, refusals included, unchanged.
 */
export function servicesMethods(
  machine: Machine, driver: Driver = DRIVER, wrote: (file: string, hash: string) => void = () => {}, acknowledged: () => void = () => {},
): Record<string, ServicesMethod> {
  const written = <T extends Answer<{ ifVersion: string; file: string }>>(answer: T): T => {
    if (answer.ok && (!('changed' in answer) || answer.changed === true)) wrote(answer.file, answer.ifVersion);
    return answer;
  };
  const control = (verb: 'start' | 'stop' | 'restart', what: string): ServicesMethod => ({
    grant: 'services:control',
    describe: () => ({ title: `${what} a service`, description: `${what}s one process under this machine's process-compose.` }),
    handle: async (params, reader, client, owner) => guarded(() =>
      driver.control(machine, callerOf(reader, client, owner), { name: params['name'] as string, verb })),
  });
  return {
    'x-ahpd/services/list': {
      grant: 'services:list',
      describe: () => ({ title: 'List services', description: 'Every service in this machine\'s process-compose files, which are read-only and why, the capabilities, and the version to write against.' }),
      handle: async () => guarded(() => driver.list(machine)),
    },
    'x-ahpd/services/put': {
      grant: 'services:put',
      describe: () => ({ title: 'Put a service', description: 'Creates or changes one service in the machine\'s own file, against the version read.' }),
      handle: async (params, reader, client, owner) => guarded(async () =>
        written(await driver.put(machine, callerOf(reader, client, owner), params as unknown as PutParams))),
    },
    'x-ahpd/services/remove': {
      grant: 'services:delete',
      describe: () => ({ title: 'Remove a service', description: 'Takes one service out of the machine\'s own file, against the version read.' }),
      handle: async (params, reader, client, owner) => guarded(async () =>
        written(await driver.remove(machine, callerOf(reader, client, owner), params as unknown as { name: string; ifVersion: string; seen?: string }))),
    },
    'x-ahpd/services/start': control('start', 'Start'),
    'x-ahpd/services/stop': control('stop', 'Stop'),
    'x-ahpd/services/restart': control('restart', 'Restart'),
    'x-ahpd/services/logs': {
      grant: 'services:get',
      describe: () => ({ title: 'Read a service\'s log', description: 'One bounded read of a process\'s log lines.' }),
      handle: async (params, reader, client, owner) => guarded(() =>
        driver.logs(machine, callerOf(reader, client, owner), params as { name: string; endOffset?: number; limit?: number })),
    },
    'x-ahpd/services/acknowledge': {
      grant: 'services:put',
      describe: () => ({ title: 'Acknowledge the files', description: 'Accepts the -f files as they are now, pinned to the hashes list answered, so drift stops alerting on an edit made outside the driver. Writes no file and changes nothing running.' }),
      handle: async (params, reader, client, owner) => guarded(() => {
        const answer = driver.acknowledge(machine, callerOf(reader, client, owner), params as unknown as AcknowledgeParams, wrote);
        if (answer.ok) acknowledged();
        return answer;
      }),
    },
    // Under `services:list`, so the grant that lets Hightea list a machine lets it keep that machine's backup (@cto c89ade9c).
    'x-ahpd/services/backup': {
      grant: 'services:list',
      describe: () => ({ title: 'Back up services', description: 'What list answers plus the change-log lines after a cursor, at most 200 lines or 256 KB: no program output, vault values, plain env values or file text. Reads only.' }),
      handle: async (params) => guarded(() => driver.backup(machine, params as BackupParams)),
    },
  };
}

/** The plugin's options, read, or the sentence naming the one that is wrong. */
export function machineOf(configDir: string, options: Record<string, unknown>): { machine: Machine; stateFile: string } | string {
  const { files, socket, tokenFile, changeLog, machine } = options;
  const absolute = (value: unknown): value is string => typeof value === 'string' && isAbsolute(value);
  if (!Array.isArray(files) || files.length === 0 || !files.every(absolute)) {
    return 'services plugin: "files" must list process-compose\'s -f files as absolute paths, in the order process-compose is given them';
  }
  if (!absolute(socket)) return 'services plugin: "socket" must be the absolute path of process-compose\'s Unix socket (its -u)';
  if (tokenFile !== undefined && !absolute(tokenFile)) return 'services plugin: "tokenFile" must be an absolute path (process-compose\'s --token-file)';
  if (changeLog !== undefined && !absolute(changeLog)) return 'services plugin: "changeLog" must be an absolute path';
  if (machine !== undefined && (typeof machine !== 'string' || machine.trim() === '')) return 'services plugin: "machine" must be a non-empty name';
  const own = join(configDir, 'services');
  return {
    machine: {
      name: (machine as string | undefined) ?? hostname(),
      files: files as string[],
      configDir,
      changeLog: (changeLog as string | undefined) ?? join(own, 'changes.jsonl'),
      pc: { socket, ...(tokenFile === undefined ? {} : { tokenFile: tokenFile as string }) },
    },
    stateFile: join(own, 'drift.json'),
  };
}

/**
 * Keep the plugin's drift alerts equal to `alerts`: raise a new or changed one,
 * clear one that went. Answers what is raised now.
 */
export function showDrift(host: Pick<ServicesHost, 'alert' | 'clearAlert'>, raised: ReadonlyMap<string, string>, alerts: readonly DriftAlert[]): Map<string, string> {
  const now = new Map(alerts.map((one) => [one.ref, one.text]));
  for (const one of alerts) if (raised.get(one.ref) !== one.text) host.alert(one);
  for (const ref of raised.keys()) if (!now.has(ref)) host.clearAlert(ref);
  return now;
}

export const apply = (host: ServicesHost, options: Record<string, unknown>): void => {
  host.registerGrants('services', {
    title: 'Services',
    description: 'The programs this machine\'s process-compose runs: listing them, reading their logs, changing the machine\'s own file, and starting or stopping them.',
    operations: ['list', 'get', 'put', 'delete', 'control'],
  });
  const read = machineOf(host.configDir, options);
  if (typeof read === 'string') {
    // Loud and in place: the plugin's page says what is wrong, and every method answers the same sentence.
    host.alert({ level: 'error', text: read, ref: 'services-options' });
    const refusal: Refusal = { ok: false, code: 'NOT_CONFIGURED', message: read };
    for (const method of METHODS) {
      host.registerMethod(method, { grant: 'services:list', describe: () => ({ title: method }), handle: async () => refusal });
    }
    return;
  }
  const { machine, stateFile } = read;
  let raised = new Map<string, string>();
  const check = async (): Promise<void> => {
    try {
      raised = showDrift(host, raised, await checkDrift(machine, stateFile));
    }
    catch (error) {
      host.alert({ level: 'error', text: `the drift check failed: ${(error as Error).message}`, ref: `${DRIFT_REF}check` });
    }
  };
  const wrote = (file: string, hash: string): void => {
    try {
      acknowledge(stateFile, file, hash);
    }
    catch (error) {
      host.alert({ level: 'error', text: `cannot record ${file} as written in ${stateFile}: ${(error as Error).message}`, ref: `${DRIFT_REF}state` });
    }
  };
  try {
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(machine.changeLog), { recursive: true, mode: 0o700 });
  }
  catch (error) {
    host.alert({ level: 'error', text: `cannot make the services directory: ${(error as Error).message}`, ref: 'services-options' });
  }
  for (const [method, served] of Object.entries(servicesMethods(machine, DRIVER, wrote, () => { void check(); }))) host.registerMethod(method, served);
  void check();
  const timer = setInterval(() => { void check(); }, DRIFT_EVERY_MS);
  timer.unref();
  host.registerClose(() => { clearInterval(timer); });
};
