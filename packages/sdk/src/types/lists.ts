/**
 * A list a plugin declares and the kinds any plugin adds to it.
 *
 * A list is what every row in it shares, whatever its kind: the scheme of one
 * row, the channel a client subscribes to, the words a client shows, and the
 * filters and sorts a query may name. A kind is one type of record in a list,
 * with its own schema and verbs, and it keeps its own rows: the host keeps the
 * list's structure and asks the kinds for every row, and keeps none.
 *
 * This is step 1 of `.project/briefs/a-list-and-its-kinds.md`: a list with no
 * instances and no paging, and kinds of class `data`.
 */

import type { KindOperation } from './kinds.js';
import type { Principal } from './users.js';

/**
 * How a filter matches a kind's field.
 *
 * `enum` matches a field with `enum`, and `boolean` a `boolean` field. `range`
 * and `uri` are named so a declaration reads as the brief writes it; they are
 * refused until the step that builds them.
 */
export type ListFilterType = 'enum' | 'range' | 'uri' | 'boolean';

/** One filter of a list: the field a query names, and how a kind's field matches it. */
export interface ListFilter {
  /** The field's name in a query and in each kind's schema. */
  field: string;
  type: ListFilterType;
  /** For a `uri` filter, the channel its picker lists. */
  channel?: string;
}

/** What `registerList` is given. */
export interface ListDeclaration {
  /** The scheme of one row, `<name>://<id>`, and the subject of the list's grants. */
  name: string;
  /** The list's channel scheme, such as `x-ahpd-todos`, so the list is `x-ahpd-todos://`. */
  channel: string;
  /** What a client shows for the list. */
  title: string;
  description?: string;
  icon?: string;
  /** Whether a row's URI carries an instance. Refused until the step that builds instances. */
  instances?: boolean;
  /** The filters a query may set, in the order a client draws them. */
  filters?: ListFilter[];
  /** The fields a free-text search reads, as `?search=`. */
  search?: string[];
  /** The fields a client may sort by. */
  sorts?: string[];
  /** The order with none asked: a field of `sorts`, with `-` for descending. */
  defaultSort?: string;
  /** The page size. Refused until the step that builds the merged cursor. */
  page?: { size: number };
}

/**
 * What a query of a list asks of each kind: the filters set, by field, each
 * with the values any of which a row may have; the free text; and the sort,
 * with `-` for descending.
 */
export interface ListQuery {
  filters: Record<string, string[]>;
  search?: string;
  sort?: string;
}

/** One row as a kind answers it: its id, who made it, and the fields of the kind's schema. */
export interface ListRow {
  /** The row's slug, so its URI is `<name>://<id>`. */
  id: string;
  /** Who made it: `user:<id>`, a team or the host. */
  owner?: string;
  /** The fields of the kind's schema, and only those. */
  record: Record<string, unknown>;
}

/**
 * Where a kind's rows are.
 *
 * `list` answers the rows a query asks for, filtered and sorted by the kind,
 * and `read` answers one row, or nothing for an id the kind does not hold.
 * `instance` is undefined until instances are built. `reader` is the person
 * asking, so a kind may answer only what they may read.
 */
export interface ListRows {
  list(query: ListQuery, instance: string | undefined, reader: Principal | undefined): ListRow[] | Promise<ListRow[]>;
  read(id: string, instance: string | undefined, reader: Principal | undefined): ListRow | undefined | Promise<ListRow | undefined>;
}

/** Which field of a row holds the URI of a row of another list, and the field there that points back. */
export interface ListRelation {
  /** The channel of the other list. */
  channel: string;
  /** The field on the other list that holds this row's URI, where this row points at one. */
  one?: string;
  /** The field on the other list that holds this row's URI, where this row points at many. */
  many?: string;
}

/** What `registerKind` is given. */
export interface ListKind {
  /** The channel of the list it joins, such as `x-ahpd-todos`. */
  channel: string;
  /** Its name, unique in the list, and the part of each operation id before the slash. */
  name: string;
  /** What a client shows for the kind, and the label of its create. */
  title: string;
  description?: string;
  icon?: string;
  /** `data`, a record a person reads and changes. `runtime` is refused until the step that builds its hooks. */
  class?: 'data' | 'runtime';
  /** The fields a row has, as JSON Schema with AHP's `enumLabels`. Create and update take it as their form. */
  schema: Record<string, unknown>;
  /** The kind's own verbs, beside the create, update and remove the host lists for every kind. */
  operations?: KindOperation[];
  /** Which fields hold the URI of a row of another list. Kept, and served by a later step. */
  relations?: Record<string, ListRelation>;
  /** Where the kind's rows are. */
  rows: ListRows;
  /**
   * Run one operation on the kind: `create`, `update`, `remove` or one of its
   * own, by the id after the kind's name.
   *
   * `row` is the row it was pointed at, read with `rows.read`, and undefined
   * for an operation on the list as a whole, such as `create`. `input` is what
   * the host checked against the schema. A create answers the id of the row it
   * made, so the host can answer the caller with it. A throw fails the call
   * with its message. A row that changed is said with the handle's `changed`.
   */
  invoke(
    operation: string,
    row: ListRow | undefined,
    input?: Record<string, unknown>,
    process?: ProcessWork,
  ): string | void | Promise<string | void>;
  /**
   * The processes the kind ran or runs: a service it started, a deploy, a CI
   * job. The kind answers them from where the work lives - its own store, the
   * system that runs it, the CI's API - and the host keeps none. Required
   * when an operation is `long`.
   */
  processes?: ListProcesses;
}

/** How a process is going: `running` is a resting state for a service and a passing one for a job. */
export type ProcessLifecycle = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

/** One process as a kind answers it. */
export interface ListProcess {
  /** Its id, unique in its kind, so its URI is `x-ahpd-processes://<list>/<kind>/<id>`. */
  id: string;
  /** What a client shows for it. */
  title?: string;
  /** The row it runs for, and the operation that started it, where it has them. */
  origin?: { row?: string; operation?: string };
  lifecycle: ProcessLifecycle;
  /** When it started and ended, as ISO dates. */
  startedAt?: string;
  endedAt?: string;
  /** How far it is, from 0 to 1, where it knows. */
  progress?: number;
  /** Its log lines so far, or the last of them. */
  log?: string[];
  /** Why it failed. */
  error?: string;
}

/** Where a kind's processes are. */
export interface ListProcesses {
  /** Every process the reader may see, newest first. */
  list(reader: Principal | undefined): ListProcess[] | Promise<ListProcess[]>;
  /** One process, or nothing for an id the kind does not hold. */
  read(id: string, reader: Principal | undefined): ListProcess | undefined | Promise<ListProcess | undefined>;
  /** Stop one process the host did not start, such as a CI job. Absent, only a process the host runs can stop. */
  stop?(id: string): void | Promise<void>;
}

/** What one report of a running process says; each part is relayed to the process's subscribers. */
export interface ProcessReport {
  lifecycle?: ProcessLifecycle;
  progress?: number;
  /** One log line. */
  line?: string;
  error?: string;
}

/**
 * What a long operation's `invoke` is handed: the id the host gave its
 * process, a report the host relays to subscribers, and a signal a stop
 * aborts. The kind keeps the process itself, so a read answers it later.
 */
export interface ProcessWork {
  id: string;
  report(report: ProcessReport): void;
  signal: AbortSignal;
}

/** What `registerKind` answers: how the kind tells the host a row changed. */
export interface ListKindHandle {
  /**
   * Say one row changed, was made or was removed. The host reads it again with
   * `rows.read` and tells the list's subscribers. `instance` is undefined until
   * instances are built.
   */
  changed(instance: string | undefined, id: string): void;
  /** Say one process changed, started or ended. The host reads it again with `processes.read` and tells its subscribers. */
  processChanged(id: string): void;
}

/** One `registerList` as the fold keeps it, with the plugin that declared it. */
export interface ServedListDeclaration extends ListDeclaration {
  by: string;
}

/** One kind as the fold keeps it, with the plugin that registered it and the handle's target. */
export interface ServedListKind extends ListKind {
  by: string;
  /** Set by the list channel once a host serves it: how a `changed` reaches it. */
  changed?: (instance: string | undefined, id: string) => void;
  /** Set by the list channel once a host serves it: how a `processChanged` reaches it. */
  processChanged?: (id: string) => void;
  /** A warning on the row of the plugin that registered it, for a kind that failed to answer. */
  problem?: (line: string) => void;
}

/** One list as the fold joins it: the first declaration's words, every declaration's filters and sorts, and its kinds by name. */
export interface ServedList extends ListDeclaration {
  /** The plugin whose declaration loaded first. */
  by: string;
  /** The plugins that declared it, in load order. */
  declaredBy: string[];
  /** The kinds in it, by name. */
  kinds: Record<string, ServedListKind>;
}
