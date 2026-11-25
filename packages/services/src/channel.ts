/**
 * The services driver as one channel, `x-hh-services://`, whose actions are its
 * operations (#38277; ADR-004 amendment 6, @cto 72ce9a98, eca3222c, a627c6fc,
 * 4b13c0d6, 720ff22b).
 *
 * A client subscribes to `x-hh-services://` under `service:watch` and reads one
 * row per service: its record, its state as process-compose has it, and the
 * drift alerts about it. The snapshot lists the operations (put, remove, start,
 * stop, restart, accept), each under its own grant, and
 * `x-ahpd/invokeOperation` runs them. Three resources are read with
 * `resourceRead`:
 * - `hh-service://<name>/logs`: raw output, under `service:logs`;
 * - `hh-services://backup`: the listing;
 * - `hh-services://changes`: the change log, by AHP's own byte range.
 * The last two are under `service:watch`. A byte position is the log's own
 * addressing, not a cursor of ours (amendment 6, line 38).
 *
 * Who changed something is the owner the host resolved for the connection, as
 * `invokeOperation` tells `run` (beorn/ahpd#36): never a field of the input.
 *
 * Like the rest of this package it imports nothing of `@ahpd/sdk`. The shapes
 * below are the members of the sdk's types it uses, and a test checks that
 * they agree.
 */
import {
  acknowledgeFiles, changesAt, controlService, listServices, putService, removeService, serviceLogs,
  type AcknowledgeParams, type Answer, type Caller, type Listing, type Machine, type PutParams, type Refusal,
} from './compose.js';
import { DRIFT_REF, type DriftAlert, type DriftFacts } from './drift.js';
import { CUT_COMMAND_REF, GAVE_UP_REF } from './watch.js';
import type { ServiceRecord } from './record.js';

/** The channel's scheme, and its one URI. */
export const SCHEME = 'x-hh-services';
export const CHANNEL = `${SCHEME}://`;
/**
 * The schemes the reads are served on. Not `x-`: the host keeps `x-` for
 * protocol extensions (channels and methods) and refuses it as a resource
 * scheme, which plugins name plainly (`bot:`, `push:`).
 */
export const SERVICE_SCHEME = 'hh-service';
export const READS_SCHEME = 'hh-services';
/** The listing, as a resource. */
export const BACKUP = `${READS_SCHEME}://backup`;
/** The change log, as a resource read by byte range. */
export const CHANGES = `${READS_SCHEME}://changes`;
/** The action a subscriber is sent when the snapshot changes: the whole new snapshot, never a patch (@cto 720ff22b). */
export const CHANGED = `${SCHEME}/changed`;
/** The grant subject every operation and read here names. */
export const SUBJECT = 'service';
/** The words the subject's grants are made of. */
export const GRANT_WORDS = ['watch', 'logs', 'put', 'remove', 'start', 'stop', 'restart', 'accept'] as const;

/** A grant as the sdk spells it. */
type Grant = `${string}:${string}`;

/** Who a channel, an operation or a read is asked by: the members of the sdk's `Principal` this uses. */
export interface Reader {
  readonly id: string;
  can(grant: Grant): boolean;
}

/** Who sent an operation, as `invokeOperation` tells `run`: the sdk's `OperationCaller`. */
export interface OperationCaller {
  readonly client: string;
  readonly owner?: string;
}

/** One operation as the snapshot lists it: the members of the sdk's `Operation` this sets. */
export interface ServiceOperation {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly scopes: string[];
  readonly grant: Grant;
  readonly status: 'idle';
  readonly input?: Record<string, unknown>;
}

/** The driver's functions; a test passes its own to see what each operation and read calls. */
export interface Driver {
  readonly list: typeof listServices;
  readonly put: typeof putService;
  readonly remove: typeof removeService;
  readonly control: typeof controlService;
  readonly logs: typeof serviceLogs;
  readonly acknowledge: typeof acknowledgeFiles;
  readonly changes: typeof changesAt;
}

export const DRIVER: Driver = {
  list: listServices, put: putService, remove: removeService, control: controlService, logs: serviceLogs, acknowledge: acknowledgeFiles,
  changes: changesAt,
};

/**
 * Who is asking, for the change log and the `allowRemoteCommands` check: the
 * owner the host resolved, then the principal, then the client id; always
 * remote, because nothing here can tell otherwise.
 */
export const callerOf = (reader: { readonly id: string } | undefined, client: string, owner: string | undefined): Caller => ({
  principal: owner ?? (reader === undefined ? `client:${client}` : `user:${reader.id}`),
  remote: true,
});

const schema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: 'object', properties, required });
const operation = (id: string, label: string, description: string, scopes: string[], input?: Record<string, unknown>): ServiceOperation => ({
  id, kind: SUBJECT, label, description, scopes, grant: `${SUBJECT}:${id}`, status: 'idle', ...(input === undefined ? {} : { input }),
});

/** The operations, each under the grant named for it (@cto 4b13c0d6). */
export const OPERATIONS: readonly ServiceOperation[] = [
  operation('put', 'Put a service', 'Creates or changes one service in this machine\'s own file, against the version read.', ['list'],
    schema({ service: { type: 'object' }, ifVersion: { type: 'string' }, seen: { type: 'string' } }, ['service', 'ifVersion'])),
  operation('remove', 'Remove a service', 'Takes one service out of this machine\'s own file, against the version read.', [SUBJECT],
    schema({ ifVersion: { type: 'string' }, seen: { type: 'string' } }, ['ifVersion'])),
  operation('start', 'Start', 'Starts one process under this machine\'s process-compose.', [SUBJECT]),
  operation('stop', 'Stop', 'Stops one process under this machine\'s process-compose.', [SUBJECT]),
  operation('restart', 'Restart', 'Restarts one process under this machine\'s process-compose.', [SUBJECT]),
  operation('accept', 'Accept the files', 'Accepts the -f files as they are now, pinned to the hashes the listing gave, so drift stops alerting on an edit made outside the driver. Writes no file and changes nothing running.', ['list'],
    schema({ hashes: { type: 'object' }, seen: { type: 'object' } }, ['hashes'])),
];

/** One service as the channel shows it. */
export interface ServiceRow {
  readonly name: string;
  /** The neutral record, for a service the driver can edit. */
  readonly record?: ServiceRecord & { readonly plainEnv?: readonly string[] };
  /** Why the driver cannot edit it, for one it can only show. */
  readonly readOnly?: string;
  /** Whether a `-f` file defines it: process-compose can hold one no file defines. */
  readonly inFiles: boolean;
  /** Its state as process-compose has it, or why that could not be read. */
  readonly state: { readonly status: string; readonly why?: string };
  /** The drift alerts about this service. */
  readonly alerts: readonly DriftAlert[];
}

/** What a subscriber to `x-hh-services://` holds. */
export interface ServicesState {
  readonly machine: string;
  readonly rows: readonly ServiceRow[];
  /** The drift alerts about the machine rather than one service: a file's hash, a socket that cannot be read. */
  readonly alerts: readonly DriftAlert[];
  readonly operations: readonly ServiceOperation[];
  /** The listing's version to write against, its file, the files' hashes and the driver's capabilities; absent when it could not be read. */
  readonly ifVersion?: string;
  readonly file?: string;
  readonly hashes?: Readonly<Record<string, string>>;
  readonly capabilities?: Listing['capabilities'];
  /** Why the listing could not be read, when it could not. */
  readonly error?: string;
}

const NAMED = [`${DRIFT_REF}not-loaded:`, `${DRIFT_REF}not-in-files:`, GAVE_UP_REF, CUT_COMMAND_REF];

/** The service a drift alert is about, or nothing for one about the machine. */
const aboutService = (alert: DriftAlert): string | undefined => {
  const prefix = NAMED.find((one) => alert.ref.startsWith(one));
  return prefix === undefined ? undefined : alert.ref.slice(prefix.length);
};

/**
 * The snapshot: one row per service the files define or process-compose holds,
 * each with its alerts, and the machine's own alerts beside them.
 */
export function servicesState(machine: string, listing: Answer<Listing>, running: DriftFacts['running'] | undefined, alerts: readonly DriftAlert[]): ServicesState {
  const held = typeof running === 'object' ? new Map(running.map((one) => [one.name, one.status])) : undefined;
  const stateOf = (name: string): ServiceRow['state'] => {
    if (running === undefined) return { status: 'unknown', why: 'process-compose has not been read yet' };
    if (typeof running === 'string') return { status: 'unknown', why: running };
    return { status: held!.get(name) ?? 'not loaded' };
  };
  const named = (name: string): DriftAlert[] => alerts.filter((one) => aboutService(one) === name);
  const rows: ServiceRow[] = [];
  const seen = new Set<string>();
  if (listing.ok) {
    for (const record of listing.services) {
      seen.add(record.name);
      rows.push({ name: record.name, record, inFiles: true, state: stateOf(record.name), alerts: named(record.name) });
    }
    for (const one of listing.readOnly) {
      seen.add(one.name);
      rows.push({ name: one.name, readOnly: one.reason, inFiles: true, state: stateOf(one.name), alerts: named(one.name) });
    }
  }
  for (const name of [...(held?.keys() ?? [])].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(name)) continue;
    // Held by process-compose and defined by no file the listing read: shown, so its alert has a row to sit on.
    if (listing.ok) rows.push({ name, inFiles: false, state: stateOf(name), alerts: named(name) });
  }
  return {
    machine,
    rows,
    alerts: alerts.filter((one) => aboutService(one) === undefined || !rows.some((row) => row.name === aboutService(one))),
    operations: OPERATIONS,
    ...(listing.ok
      ? { ifVersion: listing.ifVersion, file: listing.file, hashes: listing.hashes, capabilities: listing.capabilities }
      : { error: listing.message }),
  };
}

/**
 * An error the host answers with its own code and data. The host knows one by
 * its shape, named `RpcError` with a numeric code, because this package has no
 * copy of the sdk's class.
 */
export const rpcError = (code: number, message: string, data?: Record<string, unknown>): Error & { code: number; data?: Record<string, unknown> } =>
  Object.assign(new Error(message), { name: 'RpcError', code, ...(data === undefined ? {} : { data }) });

/** A driver refusal as the error `invokeOperation` and `resourceRead` answer: its code and difference kept as data (@cto 720ff22b). */
export const refusalError = (refusal: Refusal): Error & { code: number; data?: Record<string, unknown> } =>
  rpcError(refusal.code === 'DRIVER_FAILED' ? -32603 : -32602, refusal.message, { code: refusal.code, ...(refusal.diff === undefined ? {} : { diff: refusal.diff }) });

/** A driver answer without its `ok`, or the refusal thrown. */
const answered = <T extends object>(answer: Answer<T>): T => {
  if (!answer.ok) throw refusalError(answer);
  const { ok: _ok, ...rest } = answer as { ok: true } & T;
  return rest as unknown as T;
};

/** What the channel needs of the plugin around it. */
export interface ChannelContext {
  readonly machine: Machine;
  readonly driver?: Driver;
  /** The snapshot now. */
  state(): ServicesState;
  /** Told the file and its new hash after a put, remove or accept that wrote, so drift takes it as known. */
  wrote(file: string, hash: string): void;
  /** Told after an operation succeeded, so the plugin checks drift again and publishes the new snapshot. */
  changed(): void;
}

/** The channel as the host takes it: the members of the sdk's `PluginChannel` this uses. */
export interface ServicesChannel {
  readonly grant: Grant;
  snapshot(uri: string): unknown;
  describe(): { title: string; description?: string };
  readonly operations: {
    operations(): ServiceOperation[];
    offers(target: string, operationId: string): boolean;
    run(operation: { readonly id: string }, target: string | undefined, input: Record<string, unknown> | undefined, reader: Reader | undefined, caller?: OperationCaller): Promise<unknown>;
  };
}

/** One of this plugin's resource schemes, as the host takes it: the members of the sdk's `ResourceProvider` this uses. */
export interface ServicesProvider {
  describe(): { title: string; description?: string };
  /** Whether a reader without the scheme's own grant may read this URI: asked only of one the grant refuses, so nobody is never let in. */
  authorize(uri: string, reader: Reader | undefined): Promise<boolean>;
  read(uri: string, wanted?: string, reader?: Reader): Promise<{ data: string; encoding: 'utf-8'; contentType: string }>;
  readRange?(uri: string, wanted: string | undefined, range: { position?: number; length?: number }): Promise<{ data: string; encoding: 'utf-8'; contentType: string }>;
}

const json = (value: unknown): { data: string; encoding: 'utf-8'; contentType: string } =>
  ({ data: JSON.stringify(value), encoding: 'utf-8', contentType: 'application/json' });

const notServed = (uri: string, what: string): Error => rpcError(-32602, `${uri} is not a resource this machine serves; ${what}`);

/** `x-hh-services://`: the channel, and the operations it offers. */
export function servicesChannel(context: ChannelContext): ServicesChannel {
  const driver = context.driver ?? DRIVER;
  const { machine } = context;
  const row = (target: string): ServiceRow | undefined => context.state().rows.find((one) => one.name === target);
  return {
    grant: `${SUBJECT}:watch`,
    snapshot: () => context.state(),
    describe: () => ({ title: 'Services', description: `The programs process-compose runs on ${machine.name}, and what may be done to them.` }),
    operations: {
      operations: () => [...OPERATIONS],
      // A read-only entry can be started and stopped but not removed: its file is a person's to edit on the machine.
      offers: (target, operationId) => (operationId === 'remove' ? row(target)?.record !== undefined : row(target) !== undefined),
      run: async (asked, target, input, reader, caller) => {
        const who = callerOf(reader, caller?.client ?? 'unknown', caller?.owner);
        const given = input ?? {};
        const written = <T extends Answer<{ ifVersion: string; file: string }>>(answer: T): T => {
          if (answer.ok && (!('changed' in answer) || answer.changed === true)) context.wrote(answer.file, answer.ifVersion);
          return answer;
        };
        let answer: object;
        switch (asked.id) {
          case 'put': answer = answered(written(await driver.put(machine, who, given as unknown as PutParams))); break;
          case 'remove': answer = answered(written(await driver.remove(machine, who, { ...(given as { ifVersion: string; seen?: string }), name: target! }))); break;
          case 'start': case 'stop': case 'restart':
            answer = answered(await driver.control(machine, who, { name: target!, verb: asked.id })); break;
          case 'accept': answer = answered(driver.acknowledge(machine, who, given as unknown as AcknowledgeParams, context.wrote)); break;
          default: throw rpcError(-32602, `No operation called ${asked.id} on ${CHANNEL}`);
        }
        context.changed();
        return answer;
      },
    },
  };
}

/** The service a `hh-service://<name>/logs` URI names, or nothing for any other URI. */
export const logsOf = (uri: string): { name: string; limit?: number; endOffset?: number } | undefined => {
  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    return undefined;
  }
  if (url.protocol !== `${SERVICE_SCHEME}:` || url.pathname !== '/logs' || url.host === '') return undefined;
  const number = (key: string): number | undefined => {
    const value = url.searchParams.get(key);
    return value === null ? undefined : Number(value);
  };
  const limit = number('limit');
  const endOffset = number('endOffset');
  return { name: decodeURIComponent(url.host), ...(limit === undefined ? {} : { limit }), ...(endOffset === undefined ? {} : { endOffset }) };
};

/** The identity a `hh-services://changes?log=<identity>` URI holds, `''` for none, or nothing when the URI is not the change log. */
const changesOf = (uri: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    return undefined;
  }
  return url.protocol === `${READS_SCHEME}:` && url.host === 'changes' && (url.pathname === '' || url.pathname === '/') ? (url.searchParams.get('log') ?? '') : undefined;
};

/** `hh-service://<name>/logs`: one service's raw output, read under `service:logs` (@cto 4b13c0d6). */
export function serviceProvider(context: Pick<ChannelContext, 'machine' | 'driver'>): ServicesProvider {
  const driver = context.driver ?? DRIVER;
  const { machine } = context;
  return {
    describe: () => ({ title: 'A service', description: `One service on ${machine.name}: its raw output, at <name>/logs.` }),
    // Raw output can carry secrets, so being let see a service's state never lets anyone read its output.
    authorize: async (uri, reader) => reader !== undefined && logsOf(uri) !== undefined && reader.can(`${SUBJECT}:logs`),
    read: async (uri, _wanted, reader) => {
      const asked = logsOf(uri);
      if (asked === undefined) throw notServed(uri, `${SERVICE_SCHEME}:// serves <name>/logs`);
      const { name, ...bounds } = asked;
      const lines = answered(await driver.logs(machine, callerOf(reader, 'resourceRead', undefined), { name, ...bounds }));
      // Labelled for what it is: whatever the program printed, which Hightea passes on and never keeps (@cto a865c694).
      return json({ label: `raw output from ${name} on ${machine.name}`, ...lines });
    },
  };
}

/** `hh-services://backup` and `hh-services://changes`: the listing, and the change log by byte range, under `service:watch`. */
export function servicesProvider(context: Pick<ChannelContext, 'machine' | 'driver'>): ServicesProvider {
  const driver = context.driver ?? DRIVER;
  const { machine } = context;
  const changes = (uri: string, range: { position?: number; length?: number }) => {
    const log = changesOf(uri);
    if (log === undefined) throw notServed(uri, `${READS_SCHEME}:// serves backup and changes`);
    return json(answered(driver.changes(machine, range, log === '' ? undefined : log)));
  };
  return {
    describe: () => ({ title: 'Services backup', description: `What ${machine.name} runs (backup) and how it got there (changes, read by byte position).` }),
    authorize: async (uri, reader) => reader !== undefined && (uri === BACKUP || changesOf(uri) !== undefined) && reader.can(`${SUBJECT}:watch`),
    read: async (uri) => (uri === BACKUP ? json(answered(driver.list(machine))) : changes(uri, {})),
    readRange: async (uri, _wanted, range) => (uri === BACKUP ? json(answered(driver.list(machine))) : changes(uri, range)),
  };
}
