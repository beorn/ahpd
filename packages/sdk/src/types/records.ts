/**
 * Where a plugin keeps its own records.
 *
 * Named collections of JSON records, each with a slug `id`, behind one host
 * port. A plugin opens a collection with `host.records(name)` and never names
 * a file or a format, so a plugin that takes the port over with
 * `registerRecords(store, 'replace')` moves every plugin's records at once.
 */

/**
 * One record, as a plugin keeps it.
 *
 * A JSON object whose `id` is a slug. The store knows no plugin's record
 * shape, so every other field is the plugin's own to check when it reads one.
 */
export interface StoredRecord {
  /** The record's slug: lowercase letters, digits and dashes, starting with a letter. */
  id: string;
  [field: string]: unknown;
}

/** What changed in a collection, and which record it was. */
export interface RecordChange {
  /** The id of the record that changed. */
  id: string;
  /** Whether the record is new, changed, or gone. */
  type: 'added' | 'updated' | 'deleted';
}

/** How a plugin opens one collection. */
export interface CollectionOptions {
  /**
   * How a record is written as a file: as Markdown, or as JSON.
   *
   * `md` unless this names `json`. A store that writes files keeps a Markdown
   * record at `<name>/<id>.md`, with the body field below the frontmatter, and
   * a JSON record at `<name>/<id>.json`, which is the whole record. A JSON
   * collection has no body field and no file of its own.
   */
  format?: 'md' | 'json';
  /**
   * The field that holds a record's long text, if it has one.
   *
   * A store that writes a record as a file a person edits keeps this field as
   * the file's body rather than as one of its fields. A store that keeps rows
   * reads it as any other field. A JSON collection has no body field.
   */
  body?: string;
  /**
   * The file the record is kept in, for a collection in a folder of its own.
   *
   * A store that writes files keeps record `<id>` at `<name>/<id>/<file>.md`
   * when this is named, and at `<name>/<id>.md` when it is not. A plugin uses
   * it to give a folder of a record's own to the data that belongs beside it,
   * so one delete takes all of it. A JSON collection has no file of its own.
   */
  file?: string;
}

/**
 * One named collection of records.
 *
 * Every call answers a promise, because a store over a database answers later.
 */
export interface RecordCollection {
  /** One record, or nothing when the collection holds none with this id. */
  get(id: string): Promise<StoredRecord | undefined>;
  /** Every record, in no particular order. */
  list(): Promise<StoredRecord[]>;
  /** Every record whose top-level fields equal each field of `match`. */
  find(match: Record<string, unknown>): Promise<StoredRecord[]>;
  /**
   * Keep one record, replacing what its id held by default. A record whose `id` is not a slug is refused.
   * createOnly atomically refuses an existing id with conflict code -32010; it never replaces that winner.
   * A durable store arbitrates on the authoritative complete record, refreshes a conflicting winner before
   * rejecting, and must keep uncertain publication distinct from a proven conflict.
   */
  put(record: StoredRecord, options?: { createOnly?: boolean }): Promise<void>;
  /** Take one record out. `true` when one was there. */
  remove(id: string): Promise<boolean>;
  /** Hear each change to the collection, until the function it answers is called. */
  watch(onChange: (change: RecordChange) => void): () => void;
}

/**
 * The host port that holds every plugin's collections.
 *
 * The daemon gives one that keeps each record as a file, and a plugin takes it
 * over with `registerRecords(store, 'replace')`.
 */
export interface RecordStore {
  /**
   * Open one collection, by a name.
   *
   * A name is one slug, or a path of up to three slugs joined by `/`, such as
   * `bots/motion/chats`. A store that writes files keeps a path as that many
   * folders, so a plugin can put everything about one record in a folder of
   * its own.
   */
  collection(name: string, options?: CollectionOptions): Promise<RecordCollection>;
}
