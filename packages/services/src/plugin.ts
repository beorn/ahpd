/**
 * The services driver as an ahpd plugin (#38277, @cto).
 *
 * It serves one channel, `x-hh-services://`, whose actions are its operations
 * (ADR-004 amendment 6), and two resource schemes: `hh-service://<name>/logs`
 * and `hh-services://{backup,changes}` (see `channel.ts`). It registers the
 * `service` grants a role is given them by, and runs the drift check at start,
 * at supervisor completion, every five minutes and after each operation,
 * publishing the new snapshot to every subscriber.
 *
 * The nine `x-ahpd/services/*` methods this plugin served before 0.16.0 are
 * gone. Each name still answers, with a refusal naming the release that
 * replaced it, so a host or CLI still on the old calls is told what to update
 * rather than getting a bare method-not-found (@cto 4b13c0d6).
 *
 * Who is asking: an operation's `run` is told the owner the host resolved for
 * the connection (beorn/ahpd#36), never anything from its input. A root
 * connection's token, a person's key and the Hightea pipe plugin (a local
 * process relaying a remote person) are all accepted from anywhere the daemon
 * listens, so nothing here can tell a person at this machine from one
 * elsewhere. Every caller is therefore remote (the safe side, @cto): with
 * `allowRemoteCommands` off, a new command is written by editing the file on
 * the machine.
 *
 * The package imports nothing of `@ahpd/sdk`: the host is read through the
 * few members named below, which the daemon's `PluginHost` has, and a test
 * checks that the shapes agree.
 */
import { mkdirSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import {
  CHANGED, CHANNEL, DRIVER, GRANT_WORDS, READS_SCHEME, SCHEME, SERVICE_SCHEME, SUBJECT,
  rpcError, servicesChannel, serviceProvider, servicesProvider, servicesState,
  type Driver, type ServicesChannel, type ServicesProvider, type ServicesState,
} from './channel.js';
import { isUnreadableLine, type ComposeMachine } from './compose.js';
import { DRIFT_REF, acknowledge, checkDrift, type DriftAlert, type DriftFacts } from './drift.js';
import { pcStateStream } from './pc.js';
import { GAVE_UP_REF, watchAlerts } from './watch.js';

export { DRIVER, callerOf, type Driver } from './channel.js';

/** The plugin's id. */
export const name = 'services';

/** What a listing prints. */
export const title = 'Services';

/** The release that replaced the nine methods with the channel: what a refusal of an old method names. */
export const REPLACED_IN = '@hallohuman/hightea-services 0.16.0';

/** The alert a read of the change log raises for a line it could not read; one per machine, whatever the line. */
export const UNREADABLE_REF = 'services-changelog:unreadable';

/** How often drift is checked, after the check at start. */
export const DRIFT_EVERY_MS = 5 * 60 * 1000;
const STREAM_RETRY_MS = 15_000;

/** The methods this plugin served before the channel, by the operation or read that replaced each. */
export const RETIRED: Readonly<Record<string, string>> = {
  'x-ahpd/services/list': `a subscribe to ${CHANNEL}`,
  'x-ahpd/services/put': `the put operation on ${CHANNEL}`,
  'x-ahpd/services/remove': `the remove operation on ${CHANNEL}`,
  'x-ahpd/services/start': `the start operation on ${CHANNEL}`,
  'x-ahpd/services/stop': `the stop operation on ${CHANNEL}`,
  'x-ahpd/services/restart': `the restart operation on ${CHANNEL}`,
  'x-ahpd/services/logs': `a resourceRead of ${SERVICE_SCHEME}://<name>/logs`,
  'x-ahpd/services/acknowledge': `the accept operation on ${CHANNEL}`,
  'x-ahpd/services/backup': `resourceReads of ${READS_SCHEME}://backup and ${READS_SCHEME}://changes`,
};

/** A method as the host serves it: the members of the sdk's `PluginMethod` this uses. */
export interface ServicesMethod {
  readonly grant: `${string}:${string}`;
  describe(): { title: string; description?: string };
  authorize?(params: Record<string, unknown>, reader: { readonly id: string }): Promise<boolean>;
  handle(params: Record<string, unknown>, reader: { readonly id: string } | undefined, client: string, owner?: string): Promise<unknown>;
}

/** What `registerChannel` answers: the members of the sdk's `ChannelHandle` this uses. */
export interface ServicesChannelHandle {
  publish(uri: string, action: { type: string } & Record<string, unknown>): void;
  subscribers(uri: string): unknown[];
}

/** The members of the sdk's `PluginHost` this plugin uses. */
export interface ServicesHost {
  readonly configDir: string;
  registerMethod(name: string, method: ServicesMethod): void;
  registerGrants(subject: string, entry: { title?: string; description?: string; operations: string[] }): void;
  registerChannel(scheme: string, channel: ServicesChannel): ServicesChannelHandle;
  registerResourceProvider(scheme: string, provider: ServicesProvider): void;
  registerClose(close: () => void | Promise<void>): void;
  alert(alert: DriftAlert): void;
  clearAlert(ref: string): void;
}

/** An old method's answer: refused, naming what replaced it and in which release, never a bare method-not-found. */
export const retiredMethod = (method: string): ServicesMethod => ({
  grant: `${SUBJECT}:watch`,
  describe: () => ({ title: `${method} (replaced)`, description: `Replaced by ${RETIRED[method]} in ${REPLACED_IN}.` }),
  // Anyone is let in to be told: the answer is only a refusal, and a caller still on the old grants holds none of the new.
  authorize: async () => true,
  handle: async () => {
    throw rpcError(
      -32601,
      `${method} was replaced by ${RETIRED[method]} in ${REPLACED_IN}; update the caller (the Hightea CLI and gateway) to a release that uses it`,
      { replacedBy: RETIRED[method], release: REPLACED_IN },
    );
  },
});

/**
 * The plugin's options, read, or the sentence naming the one that is wrong.
 *
 * `who` is the plugin whose options these are. This reader serves more than the
 * services plugin - the deploy plugin reads a machine's services from the same
 * options - and a sentence that names the wrong entry sends a person to the
 * configuration block that is fine.
 */
export function machineOf(configDir: string, options: Record<string, unknown>, who = 'services plugin'): { machine: ComposeMachine; stateFile: string } | string {
  const { files, socket, tokenFile, changeLog, machine } = options;
  const absolute = (value: unknown): value is string => typeof value === 'string' && isAbsolute(value);
  if (!Array.isArray(files) || files.length === 0 || !files.every(absolute)) {
    return `${who}: "files" must list process-compose's -f files as absolute paths, in the order process-compose is given them`;
  }
  if (!absolute(socket)) return `${who}: "socket" must be the absolute path of process-compose's Unix socket (its -u)`;
  if (tokenFile !== undefined && !absolute(tokenFile)) return `${who}: "tokenFile" must be an absolute path (process-compose's --token-file)`;
  if (changeLog !== undefined && !absolute(changeLog)) return `${who}: "changeLog" must be an absolute path`;
  if (machine !== undefined && (typeof machine !== 'string' || machine.trim() === '')) return `${who}: "machine" must be a non-empty name`;
  const own = join(configDir, 'services');
  return {
    machine: {
      name: (machine as string | undefined) ?? hostname(),
      configDir,
      changeLog: (changeLog as string | undefined) ?? join(own, 'changes.jsonl'),
      backend: { kind: 'process-compose', files: files as string[], pc: { socket, ...(tokenFile === undefined ? {} : { tokenFile: tokenFile as string }) } },
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

const notConfigured = (reason: string): ServicesState => ({ machine: hostname(), rows: [], alerts: [], operations: [], error: reason });

export const apply = (host: ServicesHost, options: Record<string, unknown>, driver: Driver = DRIVER): void => {
  host.registerGrants(SUBJECT, {
    title: 'Services',
    description: 'The programs this machine\'s process-compose runs: watching them, reading their raw output, changing the machine\'s own file, starting and stopping them, and accepting an edit made on the machine.',
    operations: [...GRANT_WORDS],
  });
  for (const method of Object.keys(RETIRED)) host.registerMethod(method, retiredMethod(method));
  const read = machineOf(host.configDir, options);
  if (typeof read === 'string') {
    // Loud and in place: the plugin's page says what is wrong, the channel's snapshot says it, and nothing runs.
    host.alert({ level: 'error', text: read, ref: 'services-options' });
    host.registerChannel(SCHEME, {
      grant: `${SUBJECT}:watch`,
      snapshot: () => notConfigured(read),
      describe: () => ({ title: 'Services', description: read }),
      operations: { operations: () => [], offers: () => false, run: async () => { throw rpcError(-32602, read, { code: 'NOT_CONFIGURED' }); } },
    });
    return;
  }
  const { machine, stateFile } = read;
  let raised = new Map<string, string>();
  let running: DriftFacts['running'] | undefined;
  let alerts: DriftAlert[] = [];
  // The listing is read fresh each time (a file read), so a row a put just wrote is there before the next drift check.
  const state = (): ServicesState => servicesState(machine.name, driver.list(machine), running, alerts);
  let handle: ServicesChannelHandle | undefined;
  const publish = (): void => {
    try {
      // Nobody to tell (and, before the daemon builds its host, nowhere to send): a subscriber reads a fresh snapshot.
      if (handle === undefined || handle.subscribers(CHANNEL).length === 0) return;
      handle.publish(CHANNEL, { type: CHANGED, state: state() });
    }
    catch (error) {
      host.alert({ level: 'error', text: `cannot send the services snapshot: ${(error as Error).message}`, ref: `${DRIFT_REF}publish` });
    }
  };
  /*
   * A change-log line a read could not parse (@cto f7a8801f): one alert, naming where, until the log is replaced.
   * The log's identity is kept with the alert, and the drift check clears it once the log is another file or gone.
   */
  let unreadableIn: string | undefined;
  const logIdentity = (): string | undefined => {
    try {
      const stat = statSync(machine.changeLog, { bigint: true });
      // Creation time as well: ext4 gives a replaced log's inode number to the next file made.
      return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
    }
    catch {
      return undefined;
    }
  };
  const checkUnreadable = (): void => {
    if (unreadableIn !== undefined && logIdentity() !== unreadableIn) {
      unreadableIn = undefined;
      host.clearAlert(UNREADABLE_REF);
    }
  };
  const noteUnreadable = (line: { offset: number }, log: string | undefined): void => {
    if (unreadableIn !== undefined && unreadableIn === log) return;
    unreadableIn = log;
    host.alert({ level: 'warning', text: `services change log has an unreadable line at ${line.offset} (${machine.changeLog})`, ref: UNREADABLE_REF });
  };
  const stops = new Map<string, number>();
  let changesPosition = 0;
  let changesLog: string | undefined;
  // Read new journal entries on demand. A replaced journal cannot vouch for an old stop.
  const readStops = (): string | undefined => {
    let page = driver.changes(machine, { position: changesPosition }, changesLog);
    if (!page.ok && page.code === 'CHANGES_REPLACED') {
      stops.clear();
      changesPosition = 0;
      changesLog = undefined;
      page = driver.changes(machine);
    }
    while (page.ok) {
      for (const line of page.lines) {
        if (isUnreadableLine(line)) {
          stops.clear();
          noteUnreadable(line, page.log);
          continue;
        }
        if (line.refused !== undefined || typeof line.name !== 'string') continue;
        if (line.op === 'stop' && typeof line.at === 'string') stops.set(line.name, Date.parse(line.at));
        else if (line.op === 'start' || line.op === 'restart') stops.delete(line.name);
      }
      const advanced = page.end > changesPosition;
      changesPosition = page.end;
      changesLog = page.log;
      if (!advanced || page.end === page.size) return undefined;
      page = driver.changes(machine, { position: changesPosition }, changesLog);
    }
    return page.message;
  };
  const pendingStops = new Set<{ name: string }>();
  let closed = false;
  const check = async (): Promise<void> => {
    try {
      checkUnreadable();
      const drift = await checkDrift(machine, stateFile, (facts) => { running = facts.running; });
      if (closed) return;
      // @cto 8f8fafce (2, 5): a program process-compose gave up on, and a command YAML cut short, beside the drift.
      let watched = watchAlerts(machine.name, driver.list(machine), running);
      if (typeof running === 'object' && watched.some((alert) => alert.ref.startsWith(GAVE_UP_REF))) {
        const historyError = readStops();
        if (historyError !== undefined) drift.push({ level: 'error', ref: `${DRIFT_REF}stop-history`, text: historyError });
        const held = new Map(running.map((one) => [one.name, one]));
        const pending = new Set([...pendingStops].map((request) => request.name));
        watched = watched.flatMap((alert) => {
          if (!alert.ref.startsWith(GAVE_UP_REF)) return [alert];
          const name = alert.ref.slice(GAVE_UP_REF.length);
          const row = held.get(name);
          const stop = historyError === undefined ? stops.get(name) : undefined;
          if (stop !== undefined && row?.startedAt !== undefined && row.endedAt !== undefined
            && Date.parse(row.startedAt) <= stop && stop <= Date.parse(row.endedAt)) return [];
          // A snapshot can see the stop before the driver's acknowledgement is on disk.
          return pending.has(name) ? alerts.filter((previous) => previous.ref === alert.ref) : [alert];
        });
      }
      alerts = [...drift, ...watched];
      raised = showDrift(host, raised, alerts);
    }
    catch (error) {
      if (closed) return;
      host.alert({ level: 'error', text: `the drift check failed: ${(error as Error).message}`, ref: `${DRIFT_REF}check` });
    }
    publish();
  };
  let checking = false;
  let checkAgain = false;
  const changed = async (): Promise<void> => {
    if (closed) return;
    if (checking) {
      checkAgain = true;
      return;
    }
    checking = true;
    try {
      do {
        checkAgain = false;
        await check();
      } while (checkAgain && !closed);
    }
    finally {
      checking = false;
    }
  };
  const streamRef = `${DRIFT_REF}process-states`;
  let stream: ReturnType<typeof pcStateStream> | undefined;
  let streamProblem: string | undefined;
  const streamUnavailable = (problem: string): void => {
    if (streamProblem === problem) return;
    streamProblem = problem;
    host.alert({ level: 'warning', ref: streamRef, text: `cannot watch process-compose state on ${machine.backend.pc.socket}: ${problem}; the periodic services check is still running` });
  };
  const connectStream = (): void => {
    if (closed || stream !== undefined) return;
    try {
      const connection = pcStateStream(machine.backend.pc);
      stream = connection;
      let failure: string | undefined;
      connection.on('error', (error) => { failure = error.message; });
      connection.once('open', () => {
        if (stream !== connection || streamProblem === undefined) return;
        streamProblem = undefined;
        host.clearAlert(streamRef);
        void changed();
      });
      connection.once('close', (code) => {
        if (stream !== connection) return;
        stream = undefined;
        streamUnavailable(failure ?? `the connection closed (${code})`);
      });
      connection.on('message', (data) => {
        if (stream !== connection) return;
        let event: { snapshot?: unknown; state?: { name?: unknown; status?: unknown } } | undefined;
        try {
          event = JSON.parse(data.toString()) as typeof event;
        }
        catch (error) {
          failure = `invalid state event: ${(error as Error).message}`;
          connection.terminate();
          return;
        }
        const row = event?.state;
        if (typeof row?.name !== 'string' || typeof row.status !== 'string') {
          failure = 'a state event had no process name or status';
          connection.terminate();
          return;
        }
        // The existing check reads the current state and the acknowledged stop journal together.
        if (event?.snapshot !== true && (row.status === 'Completed' || raised.has(`${GAVE_UP_REF}${row.name}`))) {
          void changed();
        }
      });
    }
    catch (error) {
      streamUnavailable((error as Error).message);
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
  const controller: Driver = {
    ...driver,
    control: async (machine, caller, request) => {
      if (request.verb !== 'stop') return driver.control(machine, caller, request);
      pendingStops.add(request);
      let acknowledged = false;
      try {
        const answer = await driver.control(machine, caller, request);
        acknowledged = answer.ok;
        return answer;
      }
      finally {
        pendingStops.delete(request);
        if (!acknowledged) void changed();
      }
    },
  };
  handle = host.registerChannel(SCHEME, servicesChannel({ machine, driver: controller, state, wrote, changed: () => { void changed(); } }));
  host.registerResourceProvider(SERVICE_SCHEME, serviceProvider({ machine, driver }));
  const changes = servicesProvider({ machine, driver });
  // A line of the change log that could not be read is said once, as an alert, whoever read it.
  const noted = <T extends { data: string }>(answer: T): T => {
    const lines = (JSON.parse(answer.data) as { lines?: Array<Record<string, unknown>> }).lines ?? [];
    for (const line of lines) {
      if (isUnreadableLine(line)) noteUnreadable(line, logIdentity());
    }
    return answer;
  };
  host.registerResourceProvider(READS_SCHEME, {
    ...changes,
    read: async (uri, wanted, reader) => noted(await changes.read(uri, wanted, reader)),
    readRange: async (uri, wanted, range) => noted(await changes.readRange!(uri, wanted, range)),
  });
  connectStream();
  void changed();
  let nextDriftAt = Date.now() + DRIFT_EVERY_MS;
  const timer = setInterval(() => {
    const at = Date.now();
    const due = at >= nextDriftAt;
    if (due) nextDriftAt = at + DRIFT_EVERY_MS;
    // One timer keeps the usual drift cadence and also covers a lost supervisor stream.
    const disconnected = stream === undefined;
    if (disconnected) connectStream();
    if (due || disconnected) void changed();
  }, STREAM_RETRY_MS);
  timer.unref();
  host.registerClose(() => {
    closed = true;
    clearInterval(timer);
    const connection = stream;
    stream = undefined;
    connection?.terminate();
  });
};
