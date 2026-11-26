/**
 * What ahpd runs, as one channel: `x-ahpd-processes://`.
 *
 * A process is one run of something a list's record describes: a service a
 * kind started, a deploy, a CI job. The kind keeps its processes, from where
 * the work lives, and answers them through `processes`; the host keeps none.
 * A process reads at `x-ahpd-processes://<list>/<kind>/<id>`, so the path
 * names the kind to ask, and the channel's root lists every process a reader
 * may see.
 *
 * While a process the host started runs, the host holds its abort signal and
 * relays each report to the process's subscribers as `x-ahpd-processes/reported`.
 * When a kind says a process changed, the host reads it again and sends it as
 * `x-ahpd-processes/changed` on its URI and on the root. `x-ahpd/processes/stop`
 * aborts a process the host runs, or asks the kind to stop one it does not.
 */

import { randomUUID } from 'node:crypto';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { reason } from '../utils/values.js';
import type { ListProcess, ProcessReport, ProcessWork, ServedList, ServedListKind } from '../types/lists.js';
import type { PluginChannel, PluginMethod, ServedChannel, ServedMethod } from '../types/plugin.js';
import type { Grant, Principal } from '../types/users.js';

export const PROCESSES_SCHEME = 'x-ahpd-processes';
export const PROCESSES = `${PROCESSES_SCHEME}://`;
export const PROCESS_STOP = 'x-ahpd/processes/stop';
/** The grant the channel and the stop name; a reader of the process's list is let in by `authorize`. */
export const PROCESS_GRANT = 'process:get' as Grant;

/** The protocol's code for a resource that is not there. */
const NOT_FOUND = -32008;

/** One process as a client reads it: the kind's process, with its URI, list and kind. */
export interface ServedProcess extends ListProcess {
  uri: string;
  list: string;
  kind: string;
}

/** The channel of processes over one base, its stop command, and how a list starts a process. */
export interface ProcessesServing {
  served: ServedChannel;
  method: ServedMethod;
  /** Serve the lists a fold joined. */
  update(lists: Record<string, ServedList>): void;
  /** Run `work` as a new process of a kind, and answer its URI at once. */
  start(list: ServedList, kind: ServedListKind, work: (process: ProcessWork) => Promise<void>): string;
  /** Read a process again and tell its subscribers. */
  changed(list: string, kind: string, id: string): void;
}

/** The URI of one process. */
export const processUri = (list: string, kind: string, id: string): string => `${PROCESSES}${list}/${kind}/${encodeURIComponent(id)}`;

/** The list, kind and id a process URI names, or nothing for the root. */
const partsOf = (uri: string): { list: string; kind: string; id: string } | undefined => {
  const path = uri.slice(PROCESSES.length).replace(/^\/+/, '');
  if (path === '') return undefined;
  const [list, kind, ...rest] = path.split('/');
  if (list === undefined || kind === undefined || rest.length === 0) {
    throw new RpcError(INVALID_PARAMS, `${uri} is not a process; read ${PROCESSES}<list>/<kind>/<id>`);
  }
  return { list, kind, id: decodeURIComponent(rest.join('/')) };
};

/** Build the channel of processes. `onProblem` is told of a kind that fails to answer. */
export function processesChannel(onProblem: (message: string) => void = () => {}): ProcessesServing {
  let lists: Record<string, ServedList> = {};
  /** The abort of each process the host runs now, by URI. */
  const running = new Map<string, AbortController>();

  const kindOf = (list: string, kind: string): { list: ServedList; kind: ServedListKind } => {
    const held = lists[list];
    const found = held?.kinds[kind];
    if (held === undefined || found?.processes === undefined) throw new RpcError(NOT_FOUND, `No processes of ${list} ${kind}`);
    return { list: held, kind: found };
  };

  const mayRead = (list: string, reader: Principal | undefined): boolean => reader === undefined || reader.can(`${list}:get` as Grant);

  const served = (list: string, kind: string, process: ListProcess): ServedProcess => ({ ...process, uri: processUri(list, kind, process.id), list, kind });

  const read = async (uri: string, reader: Principal | undefined): Promise<ServedProcess> => {
    const parts = partsOf(uri);
    if (parts === undefined) throw new RpcError(INVALID_PARAMS, `${uri} is the list of processes`);
    const { kind } = kindOf(parts.list, parts.kind);
    const process = await kind.processes!.read(parts.id, reader);
    if (process === undefined) throw new RpcError(NOT_FOUND, `No process at ${uri}`);
    return served(parts.list, parts.kind, process);
  };

  /** Every process a reader may see, from each kind that keeps them, newest first. */
  const all = async (reader: Principal | undefined): Promise<ServedProcess[]> => {
    const asked: Promise<ServedProcess[]>[] = [];
    for (const list of Object.values(lists)) {
      if (!mayRead(list.name, reader)) continue;
      for (const kind of Object.values(list.kinds)) {
        if (kind.processes === undefined) continue;
        asked.push(Promise.resolve(kind.processes.list(reader))
          .then((processes) => processes.map((one) => served(list.name, kind.name, one)))
          .catch((error: unknown) => {
            kind.problem?.(`kind ${kind.name} could not list its processes: ${reason(error)}`);
            onProblem(`plugin ${kind.by}: kind ${kind.name} could not list its processes: ${reason(error)}`);
            return [];
          }));
      }
    }
    return (await Promise.all(asked)).flat().sort((left, right) => String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? '')));
  };

  const servedChannel: ServedChannel = {
    by: 'ahpd',
    scheme: PROCESSES_SCHEME,
    channel: undefined as unknown as PluginChannel,
  };

  const send = (uri: string, action: { type: string } & Record<string, unknown>, list?: string): void => {
    servedChannel.publish?.(uri, action, list === undefined ? {} : { visible: (reader) => mayRead(list, reader) });
  };

  const channel: PluginChannel = {
    grant: PROCESS_GRANT,
    describe: () => ({ title: 'Processes', description: 'What this host runs: services, deploys and jobs.' }),
    // A reader of a process's list may read it; the root lists only what each reader may read.
    authorize: async (uri, reader) => {
      const parts = partsOf(uri);
      return parts === undefined || mayRead(parts.list, reader);
    },
    snapshot: async (uri, reader) => {
      const parts = partsOf(uri);
      if (parts === undefined) return { processes: await all(reader) };
      return { process: await read(uri, reader) };
    },
  };
  servedChannel.channel = channel;

  /** The grant a stop asks: the grant of the operation that started the process, else the list's `put`. */
  const stopGrant = async (uri: string, reader: Principal | undefined): Promise<Grant> => {
    const process = await read(uri, reader);
    const { list, kind } = kindOf(process.list, process.kind);
    const operation = kind.operations?.find((one) => one.id === process.origin?.operation);
    return (operation?.grant ?? `${list.name}:put`) as Grant;
  };

  const stop: PluginMethod = {
    grant: PROCESS_GRANT,
    authorize: async (params, reader) => {
      const uri = typeof params['process'] === 'string' ? params['process'] : '';
      try { return reader.can(await stopGrant(uri, reader)); }
      catch { return false; }
    },
    describe: () => ({ title: 'Stop a process', description: 'Stops one process this host runs, or asks its kind to stop it.' }),
    handle: async (params, reader) => {
      const uri = typeof params['process'] === 'string' ? params['process'] : '';
      const grant = await stopGrant(uri, reader);
      if (reader !== undefined && !reader.can(grant)) throw new RpcError(-32009, `Stopping ${uri} needs ${grant}`);
      const held = running.get(uri);
      if (held !== undefined) {
        held.abort();
        return {};
      }
      const parts = partsOf(uri)!;
      const { kind } = kindOf(parts.list, parts.kind);
      if (kind.processes?.stop === undefined) throw new RpcError(INVALID_PARAMS, `${uri} is not running on this host, and its kind cannot stop it`);
      await kind.processes.stop(parts.id);
      return {};
    },
  };

  const start: ProcessesServing['start'] = (list, kind, work) => {
    const id = randomUUID();
    const uri = processUri(list.name, kind.name, id);
    const abort = new AbortController();
    running.set(uri, abort);
    const report = (said: ProcessReport): void => { send(uri, { type: `${PROCESSES_SCHEME}/reported`, ...said }, list.name); };
    report({ lifecycle: 'running' });
    void work({ id, report, signal: abort.signal })
      .then(() => { report({ lifecycle: abort.signal.aborted ? 'stopped' : 'completed' }); })
      .catch((error: unknown) => {
        report(abort.signal.aborted ? { lifecycle: 'stopped' } : { lifecycle: 'failed', error: reason(error) });
        if (!abort.signal.aborted) onProblem(`${uri} failed: ${reason(error)}`);
      })
      .finally(() => { running.delete(uri); });
    return uri;
  };

  const changed: ProcessesServing['changed'] = (list, kind, id) => {
    const uri = processUri(list, kind, id);
    void read(uri, undefined)
      .then((process) => {
        const action = { type: `${PROCESSES_SCHEME}/changed`, process };
        send(uri, action, list);
        send(PROCESSES, action, list);
      })
      .catch((error: unknown) => { onProblem(`${uri} could not be read: ${reason(error)}`); });
  };

  return {
    served: servedChannel,
    method: { by: 'ahpd', name: PROCESS_STOP, method: stop },
    update: (next) => { lists = next; },
    start,
    changed,
  };
}

/** The channel of processes kept for one base from one fold to the next. */
const servings = new WeakMap<object, ProcessesServing>();

/** The channel of processes over `base`: the one an earlier fold built, or a new one. */
export function servedProcesses(base: object): ProcessesServing {
  let held = servings.get(base);
  if (held === undefined) {
    held = processesChannel();
    servings.set(base, held);
  }
  return held;
}
