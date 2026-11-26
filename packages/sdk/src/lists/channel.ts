/**
 * One list a plugin declared, served as a channel, and its rows as a scheme.
 *
 * The host keeps the list's structure - the joined declaration and its kinds -
 * and no row: a snapshot asks every kind that takes part for its rows, merges
 * them in the order asked, and adds each row's `kind` and `operations`. A row
 * reads alone at `<name>://<id>`, from the kind that answers it.
 *
 * A subscriber may watch the plain channel or a query of it, such as
 * `x-ahpd-todos://?done=false`. The channel keeps the ids it last sent to each
 * URI it served, so when a kind says a row changed the host reads that row
 * once, tests it against each watched query, and sends each URI `added`,
 * `changed` or `removed` as the row entered, stayed in or left it.
 *
 * Its operations are each kind's create, update and remove and the kind's own,
 * built by `kindOperations`. `x-ahpd/invokeOperation` checks the grant, the
 * target and the input against the schema; the channel hands the call to the
 * kind's `invoke` with the row it read.
 */

import { kindOffers, kindOperations } from '../kinds/operations.js';
import { absentResource, asFile, splitResource } from '../resources/records.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { reason } from '../utils/values.js';
import type { ChannelOperation, Operation, OperationStatus } from '../types/kinds.js';
import type { ListQuery, ListRow, ServedList, ServedListKind } from '../types/lists.js';
import type { PluginChannel, ServedChannel } from '../types/plugin.js';
import type { Read, ResourceProvider } from '../types/resources.js';
import type { Grant, Principal } from '../types/users.js';

/** One row as a client reads it: the kind's row, with its kind, its operations and the call running on it. */
export interface ServedRow extends ListRow {
  kind: string;
  operations: string[];
  operation?: { id: string; status: OperationStatus; error?: string };
}

/** What `listChannel` builds: the channel the fold serves, the scheme of one row, and how a later fold hands it the list again. */
export interface ListServing {
  served: ServedChannel;
  provider: ResourceProvider;
  /**
   * Serve the list as a later fold joined it, keeping the channel, the
   * provider and what each watched URI was sent: a host refuses a live fold
   * that moves a resource scheme, and a subscriber keeps its view.
   */
  update(list: ServedList): void;
}

/** The query a list URI asks, checked against what the list declares. */
const queryOf = (list: ServedList, uri: string): ListQuery => {
  const at = uri.indexOf('?');
  const params = new URLSearchParams(at < 0 ? '' : uri.slice(at + 1));
  const query: ListQuery = { filters: {} };
  for (const [key, value] of params) {
    if (key === 'sort') {
      const field = value.startsWith('-') ? value.slice(1) : value;
      if (!(list.sorts ?? []).includes(field)) throw new RpcError(INVALID_PARAMS, `${list.channel}:// sorts by ${(list.sorts ?? []).join(', ') || 'nothing'}, not ${field}`);
      query.sort = value;
      continue;
    }
    if (key === 'search') {
      if ((list.search ?? []).length === 0) throw new RpcError(INVALID_PARAMS, `${list.channel}:// takes no search`);
      query.search = value;
      continue;
    }
    if (!(list.filters ?? []).some((one) => one.field === key)) {
      throw new RpcError(INVALID_PARAMS, `${list.channel}:// has no filter ${key}; it filters by ${(list.filters ?? []).map((one) => one.field).join(', ') || 'nothing'}`);
    }
    query.filters[key] = value.split(',').filter((one) => one !== '');
  }
  return query;
};

/** The schema of one field of a kind, or nothing when the kind has no such field. */
const fieldOf = (kind: ServedListKind, field: string): Record<string, unknown> | undefined => {
  const properties = kind.schema['properties'];
  if (typeof properties !== 'object' || properties === null) return undefined;
  const held = (properties as Record<string, unknown>)[field];
  return typeof held === 'object' && held !== null ? held as Record<string, unknown> : undefined;
};

/** Whether a kind takes part in a query: it has each filter's field with the filter's type, a search field, and the field asked to sort by. */
const takesPart = (list: ServedList, kind: ServedListKind, query: ListQuery): boolean => {
  for (const field of Object.keys(query.filters)) {
    const schema = fieldOf(kind, field);
    const type = list.filters?.find((one) => one.field === field)?.type;
    if (schema === undefined) return false;
    if (type === 'enum' && !Array.isArray(schema['enum'])) return false;
    if (type === 'boolean' && schema['type'] !== 'boolean') return false;
  }
  if (query.search !== undefined && !(list.search ?? []).some((field) => fieldOf(kind, field) !== undefined)) return false;
  if (query.sort !== undefined && fieldOf(kind, query.sort.replace(/^-/, '')) === undefined) return false;
  return true;
};

/** Whether one row of a kind that takes part matches a query: each filter's values, and the search as text. */
const matches = (list: ServedList, row: ListRow, query: ListQuery): boolean => {
  for (const [field, values] of Object.entries(query.filters)) {
    if (values.length === 0) continue;
    if (!values.includes(String(row.record[field]))) return false;
  }
  if (query.search !== undefined && query.search !== '') {
    const text = query.search.toLowerCase();
    const found = (list.search ?? []).some((field) => {
      const value = row.record[field];
      return value !== undefined && value !== null && String(value).toLowerCase().includes(text);
    });
    if (!found) return false;
  }
  return true;
};

/** Order two values of one field: numbers by size, anything else as text; a missing value goes last. */
const compare = (left: unknown, right: unknown): number => {
  if (left === undefined || left === null) return right === undefined || right === null ? 0 : 1;
  if (right === undefined || right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
};

/**
 * Serve one folded list: its channel, with the snapshot, the operations and
 * the live actions, and the scheme of one row.
 *
 * `onProblem` is told of a kind that throws while it answers rows, with the
 * plugin that registered it; its rows are left out and the others answered.
 */
export function listChannel(initial: ServedList, onProblem: (message: string) => void = () => {}): ListServing {
  let list = initial;
  const scheme = list.channel;
  const root = `${scheme}://`;
  const kinds = (): ServedListKind[] => Object.values(list.kinds);

  /** Say what a kind failed at, on its plugin's row and in the host's own report. */
  const warn = (kind: ServedListKind, line: string): void => {
    kind.problem?.(line);
    onProblem(`plugin ${kind.by}: ${line}`);
  };

  /** How the last call of an operation on the list as a whole went, by its id. */
  const listed = new Map<string, { status: OperationStatus; error?: string }>();
  /** The call running on a row, or the last one that ran, by the row's id. */
  const running = new Map<string, { id: string; status: OperationStatus; error?: string }>();
  /** The ids last sent to each URI a subscriber was answered at. */
  const shown = new Map<string, Set<string>>();

  const operations = (): Operation[] => kinds().flatMap((kind) => kindOperations(kind, {
    subject: list.name,
    scope: list.name,
    status: (id) => listed.get(id) ?? { status: 'idle' },
    update: true,
    words: { confirmation: `Remove this ${kind.title.toLowerCase()}?` },
  }));

  /** One row as a client reads it. */
  const served = (kind: ServedListKind, row: ListRow): ServedRow => {
    const operation = running.get(row.id);
    return {
      id: row.id,
      kind: kind.name,
      ...(row.owner === undefined ? {} : { owner: row.owner }),
      record: row.record,
      operations: kindOffers(kind, row.record, true),
      ...(operation === undefined ? {} : { operation }),
    };
  };

  /** Every row a query asks for, from each kind that takes part, merged in the order asked. */
  const rowsOf = async (query: ListQuery, reader: Principal | undefined): Promise<ServedRow[]> => {
    const answers = await Promise.all(kinds().filter((kind) => takesPart(list, kind, query)).map(async (kind) => {
      try {
        return (await kind.rows.list(query, undefined, reader)).map((row) => served(kind, row));
      }
      catch (error) {
        warn(kind, `kind ${kind.name} could not list its rows of ${list.name}: ${reason(error)}`);
        return [];
      }
    }));
    const rows = answers.flat();
    const sort = query.sort ?? list.defaultSort;
    if (sort === undefined) return rows;
    const field = sort.replace(/^-/, '');
    const way = sort.startsWith('-') ? -1 : 1;
    return rows.sort((left, right) => way * compare(left.record[field], right.record[field]));
  };

  /** The kind that holds a row, and the row, asked of each kind in turn; nothing when none does. */
  const find = async (id: string, reader: Principal | undefined): Promise<{ kind: ServedListKind; row: ListRow } | undefined> => {
    for (const kind of kinds()) {
      let row: ListRow | undefined;
      try { row = await kind.rows.read(id, undefined, reader); }
      catch (error) {
        warn(kind, `kind ${kind.name} could not read ${list.name} ${id}: ${reason(error)}`);
        continue;
      }
      if (row !== undefined) return { kind, row };
    }
    return undefined;
  };

  const servedChannel: ServedChannel = {
    by: list.by,
    scheme,
    channel: undefined as unknown as PluginChannel,
  };

  /** Send one action to every subscriber of one URI. */
  const send = (uri: string, action: { type: string } & Record<string, unknown>): void => {
    servedChannel.publish?.(uri, action, {});
  };

  /** The URIs a subscriber is on now; one nobody watches any more is forgotten. */
  const watched = (): string[] => {
    for (const uri of [...shown.keys()]) {
      if ((servedChannel.subscribers?.(uri) ?? []).length === 0) shown.delete(uri);
    }
    return [...shown.keys()];
  };

  /**
   * Read one row again and tell each watched URI what it means there: `added`
   * where it now belongs and was not sent, `changed` where it was, `removed`
   * where it was sent and no longer belongs or is gone.
   */
  const changed = async (id: string): Promise<void> => {
    const found = await find(id, undefined);
    for (const uri of watched()) {
      const ids = shown.get(uri)!;
      let query: ListQuery;
      try { query = queryOf(list, uri); }
      catch { continue; }
      const belongs = found !== undefined && takesPart(list, found.kind, query) && matches(list, found.row, query);
      if (belongs) {
        const type = ids.has(id) ? 'changed' : 'added';
        ids.add(id);
        send(uri, { type: `${scheme}/${type}`, ...served(found.kind, found.row) });
      }
      else if (ids.has(id)) {
        ids.delete(id);
        send(uri, { type: `${scheme}/removed`, id });
      }
    }
  };

  /** Tell each watched URI what the list's operations are now. */
  const publishOperations = (): void => {
    const action = { type: `${scheme}/operations`, operations: operations() };
    for (const uri of watched()) send(uri, action);
  };

  /** Point each kind's `changed` at this channel. */
  const wire = (): void => {
    for (const kind of kinds()) {
      kind.changed = (_instance, id) => {
        void changed(id).catch((error: unknown) => { onProblem(`list ${list.name} could not send ${id}: ${reason(error)}`); });
      };
    }
  };
  wire();

  /** The kind an operation id names, and the operation after its slash. */
  const operationOf = (operation: ChannelOperation): { kind: ServedListKind; name: string } => {
    const at = operation.id.indexOf('/');
    const kind = list.kinds[operation.id.slice(0, at)];
    if (kind === undefined) throw new RpcError(INVALID_PARAMS, `No kind ${operation.id.slice(0, at)} in list ${list.name}`);
    return { kind, name: operation.id.slice(at + 1) };
  };

  const channel: PluginChannel = {
    grant: `${list.name}:get` as Grant,
    describe: () => ({ title: list.title, ...(list.description === undefined ? {} : { description: list.description }) }),
    kinds: () => Object.fromEntries(kinds().map((kind) => [kind.name, {
      title: kind.title,
      ...(kind.description === undefined ? {} : { description: kind.description }),
      ...(kind.icon === undefined ? {} : { icon: kind.icon }),
      schema: kind.schema,
      operations: operations().filter((one) => one.kind === kind.name).map(({ status: _status, error: _error, kind: _kind, offered: _offered, ...rest }) => rest),
    }])),
    snapshot: async (uri, reader) => {
      const query = queryOf(list, uri);
      const records = await rowsOf(query, reader);
      shown.set(uri, new Set(records.map((one) => one.id)));
      return { records, operations: operations().filter((one) => one.scopes.includes('list')).map(({ id, status, error }) => ({ id, status, ...(error === undefined ? {} : { error }) })) };
    },
    operations: {
      operations: () => operations(),
      offers: async (target, operationId, reader) => {
        const found = await find(target, reader);
        return found !== undefined && kindOffers(found.kind, found.row.record, true).includes(operationId);
      },
      begin: (operationId, target) => {
        if (target === undefined) {
          listed.set(operationId, { status: 'running' });
          publishOperations();
          return;
        }
        running.set(target, { id: operationId, status: 'running' });
        void changed(target);
      },
      settle: (operationId, target, error) => {
        if (target === undefined) {
          listed.set(operationId, error === undefined ? { status: 'idle' } : { status: 'error', error });
          publishOperations();
          return;
        }
        running.set(target, { id: operationId, status: error === undefined ? 'idle' : 'error', ...(error === undefined ? {} : { error }) });
        void changed(target);
      },
      run: async (operation, target, input, reader) => {
        const { kind, name } = operationOf(operation);
        const found = target === undefined ? undefined : await find(target, reader);
        if (target !== undefined && found === undefined) throw absentResource(list.name, `${list.name}://${target}`);
        const made = await kind.invoke(name, found?.row, input);
        const id = typeof made === 'string' && made !== '' ? made : target;
        if (id === undefined) return {};
        const after = await find(id, reader);
        return after === undefined ? {} : served(after.kind, after.row);
      },
    },
  };
  servedChannel.channel = channel;

  const provider: ResourceProvider = {
    describe: () => ({ title: list.title, ...(list.description === undefined ? {} : { description: list.description }) }),
    read: async (uri: string, _wanted?: string, reader?: Principal): Promise<Read> => {
      const at = splitResource(uri, list.name);
      if (at.id === '' || at.leaf !== '') throw absentResource(list.name, uri);
      const found = await find(at.id, reader);
      if (found === undefined) throw absentResource(list.name, uri);
      return asFile(JSON.stringify(served(found.kind, found.row), null, 2));
    },
  };

  const update = (next: ServedList): void => {
    list = next;
    servedChannel.by = next.by;
    wire();
  };

  return { served: servedChannel, provider, update };
}

/** The lists served over one base, by name, kept from one fold to the next. */
const servings = new WeakMap<object, Map<string, ListServing>>();

/**
 * The list served for `list.name` over `base`: the one an earlier fold over
 * the same base built, handed the list again, or a new one. A list that moved
 * to another channel is a new one.
 */
export function servedList(base: object, list: ServedList, onProblem?: (message: string) => void): ListServing {
  let held = servings.get(base);
  if (held === undefined) {
    held = new Map();
    servings.set(base, held);
  }
  const before = held.get(list.name);
  if (before !== undefined && before.served.scheme === list.channel) {
    before.update(list);
    return before;
  }
  const made = listChannel(list, onProblem);
  held.set(list.name, made);
  return made;
}
