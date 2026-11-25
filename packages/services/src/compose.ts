/**
 * The process-compose driver (#38277): plain functions, no driver SDK,
 * registry or base class (@cto). The AHP method set and `list`'s capability
 * list are the interface; a second supervisor would be its own functions.
 *
 * The rules this file carries out:
 *
 * - Only the LAST file in the machine's `-f` list is written. It is the
 *   machine's own; earlier files are shared (base, package) and edited where
 *   they live.
 * - `ifVersion` is the sha256 of that file's bytes. A put or remove made
 *   against another version is refused with the difference, never merged.
 * - An edit changes only the neutral fields it carries; every other byte of the
 *   file stays as it was (see splice.ts).
 * - An entry the driver cannot read back faithfully is listed read-only with
 *   where to edit it instead.
 * - A write is a temp file in the same directory, fsync, and an atomic rename;
 *   process-compose then reloads the files from disk.
 * - Every change and every refusal is one JSON line in the change log.
 * - `backup` reads the listing and the change log after a cursor and writes
 *   nothing; a put with `ifVersion: "absent"` only creates, so a restore from
 *   that backup never overwrites what a machine already has.
 * - Every function here answers `{ ok: false, code, message }` rather than
 *   throwing into its caller, because it runs inside ahpd and a throw there
 *   is ahpd's crash (@cto's condition for running in-process).
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, fstatSync, fsyncSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isAlias, isMap, isPair, isScalar, parseDocument, visit, type Document, type Node } from 'yaml';
import { REMOTE_COMMANDS_OFF, machineSwitches } from './switches.js';
import {
  CONDITIONS, FIELDS, RESTART_POLICIES, applyPatch, checkPatch, fromNative, nativeChanges, same,
  type ServicePatch, type ServiceRecord,
} from './record.js';
import { LayoutError, addEntry, editEntry, lineDiff, processesOf, redactEnv, removeEntry } from './splice.js';
import { ROUTES, pcFailure, pcRequest, type PcSocket } from './pc.js';
import { cutCommand, cutReason } from './watch.js';

/** One machine's process-compose, as the plugin that hosts the driver configures it. */
export interface Machine {
  /** The machine's name, as a person reading "edit it in <file> on <machine>" knows it. */
  readonly name: string;
  /** process-compose's `-f` files, in the order given; the last is the one written. */
  readonly files: readonly string[];
  /** The daemon's config directory, where `machineSwitches` reads `config.json`. */
  readonly configDir: string;
  /** The JSONL change log; created 0600. */
  readonly changeLog: string;
  readonly pc: PcSocket;
}

/** Who is asking. `remote` is anybody not on this machine (Hightea's pipe included). */
export interface Caller {
  readonly principal: string;
  readonly remote: boolean;
}

export type RefusalCode =
  | 'INVALID' | 'PLAIN_ENV_VALUE' | 'NOT_FOUND' | 'READ_ONLY' | 'STALE_VERSION' | 'REMOTE_COMMANDS_OFF'
  | 'SWITCHES_UNREADABLE' | 'UNSUPPORTED_LAYOUT' | 'FILE_UNREADABLE' | 'RELOAD_FAILED' | 'PC_REFUSED'
  | 'CHANGE_LOG_UNWRITABLE' | 'DRIVER_FAILED' | 'NOT_CONFIGURED' | 'EXISTS' | 'CHANGES_REPLACED';

export interface Refusal {
  readonly ok: false;
  readonly code: RefusalCode;
  readonly message: string;
  /** On STALE_VERSION: what changed between the version the caller read and now, when the driver still holds it. */
  readonly diff?: string;
}

export type Answer<T> = ({ readonly ok: true } & T) | Refusal;

/** What `list` answers. */
export interface Listing {
  /**
   * Each editable service. `plainEnv` names, read-only, every key the file sets with a plain value
   * ("K (plain value, set in <file>)"); the value itself is never answered (@cto 7af7ed84), and turning
   * one into a secret reference is a person's edit on the machine.
   */
  readonly services: ReadonlyArray<ServiceRecord & { readonly plainEnv?: readonly string[] }>;
  readonly readOnly: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
  readonly capabilities: typeof CAPABILITIES;
  readonly ifVersion: string;
  readonly file: string;
  /** The sha256 of every `-f` file, in order: what `acknowledge` is given back to accept a change made outside the driver. */
  readonly hashes: Readonly<Record<string, string>>;
}

/** What this driver can carry. process-compose's scheduler keeps no last-run time, so a run missed while it is down is not caught up. */
export const CAPABILITIES = {
  fields: FIELDS,
  schedule: ['cron', 'interval'] as const,
  missedRunCatchup: false,
  restart: RESTART_POLICIES,
  conditions: CONDITIONS,
  health: ['exec', 'http'] as const,
} as const;

const refuse = (code: RefusalCode, message: string, diff?: string): Refusal =>
  (diff === undefined ? { ok: false, code, message } : { ok: false, code, message, diff });

const failed = (error: unknown): Refusal =>
  refuse('DRIVER_FAILED', `services driver failed: ${error instanceof Error ? error.message : String(error)}`);

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/*
 * The text of each version this process has read or written, by hash, so a
 * stale put can be shown what changed since the version it read. Memory only
 * and bounded: after ahpd restarts, a caller that wants the difference sends
 * the text it read (`seen`), and otherwise is told to read again.
 */
const VERSIONS_KEPT = 32;
const versions = new Map<string, string>();
const remember = (hash: string, text: string): void => {
  versions.delete(hash);
  versions.set(hash, text);
  while (versions.size > VERSIONS_KEPT) versions.delete(versions.keys().next().value!);
};

/** Everything a request needs from the files, read fresh each time. */
interface State {
  readonly file: string;
  readonly text: string;
  readonly doc: Document;
  readonly ifVersion: string;
  readonly services: Map<string, ServiceRecord>;
  readonly readOnly: Map<string, string>;
  /** Per read-only service, the file that defines it: what a create-only put's EXISTS names. */
  readonly readOnlyIn: Map<string, string>;
  /** Per editable service, the keys its `environment:` sets with plain values. */
  readonly plainEnv: Map<string, string[]>;
}

const parseFile = (file: string, text: string): Document => {
  const doc = parseDocument(text, { keepSourceTokens: false });
  const error = doc.errors[0];
  if (error) throw new FileError(`${file} is not YAML process-compose can read: ${error.message.split('\n')[0]}`);
  return doc;
};

class FileError extends Error {}

const readText = (file: string): { text: string; hash: string } => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  }
  catch (error) {
    throw new FileError(`cannot read ${file}: ${(error as Error).message}`);
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new FileError(`${file} is not UTF-8, so it cannot be edited byte for byte`);
  return { text, hash: sha256(bytes) };
};

/** A file's top-level `extends`, resolved beside it. */
const extendsOf = (file: string, doc: Document): string | undefined => {
  const value = doc.get('extends');
  return typeof value === 'string' ? resolve(dirname(file), value) : undefined;
};

/** The process names each shared file defines: every earlier `-f` file, and every file any of them (or the last) extends. */
function sharedNames(machine: Machine, last: string, lastDoc: Document): Map<string, string> {
  const names = new Map<string, string>();
  const seen = new Set<string>([last]);
  const visitFile = (file: string, depth: number): void => {
    if (seen.has(file) || depth > 8) return;
    seen.add(file);
    const doc = parseFile(file, readText(file).text);
    const parent = extendsOf(file, doc);
    if (parent) visitFile(parent, depth + 1);
    const processes = processesOf(doc);
    for (const pair of processes?.items ?? []) {
      if (isScalar(pair.key)) names.set(String(pair.key.value), file);
    }
  };
  const lastParent = extendsOf(last, lastDoc);
  if (lastParent) visitFile(lastParent, 0);
  for (const file of machine.files.slice(0, -1)) visitFile(resolve(file), 0);
  return names;
}

/** Whether a node carries an anchor, an alias or a merge key anywhere inside it. */
const usesAnchors = (node: unknown): boolean => {
  if (isAlias(node)) return true;
  let found = false;
  visit(node as Node, {
    Alias: () => { found = true; return visit.BREAK; },
    Node: (_, inner) => { if ((inner as { anchor?: string }).anchor) { found = true; return visit.BREAK; } return undefined; },
    Pair: (_, pair) => { if (isPair(pair) && isScalar(pair.key) && pair.key.value === '<<') { found = true; return visit.BREAK; } return undefined; },
  });
  return found || Boolean((node as { anchor?: string } | null)?.anchor);
};

function readState(machine: Machine): State {
  const last = machine.files[machine.files.length - 1];
  if (last === undefined) throw new FileError(`no process-compose files are configured for ${machine.name}`);
  const file = resolve(last);
  const { text, hash } = readText(file);
  const doc = parseFile(file, text);
  remember(hash, text);
  const shared = sharedNames(machine, file, doc);
  const where = (other: string): string => `edit it in ${other} on ${machine.name}`;
  const services = new Map<string, ServiceRecord>();
  const readOnly = new Map<string, string>();
  const readOnlyIn = new Map<string, string>();
  const plainEnv = new Map<string, string[]>();
  let processes;
  try {
    processes = processesOf(doc);
  }
  catch (error) {
    throw new FileError(`${file}: ${(error as Error).message}`);
  }
  for (const pair of processes?.items ?? []) {
    if (!isScalar(pair.key)) continue;
    const name = String(pair.key.value);
    readOnlyIn.set(name, file);
    const elsewhere = shared.get(name);
    if (elsewhere !== undefined) { readOnly.set(name, `it is also defined in ${elsewhere}; ${where(elsewhere)}`); continue; }
    if (usesAnchors(pair.value)) { readOnly.set(name, `it uses YAML anchors, aliases or merge keys; ${where(file)}`); continue; }
    // @cto 8f8fafce (5): a command YAML cut at " #" runs less than it says; the driver will not round-trip it.
    const kept = cutCommand(pair.value, text);
    if (kept !== undefined) { readOnly.set(name, `${cutReason(kept)}; ${where(file)}`); continue; }
    const native = isMap(pair.value) ? pair.value.toJSON() : pair.value;
    const record = fromNative(name, native);
    if (typeof record === 'string') { readOnly.set(name, `${record}; ${where(file)}`); continue; }
    services.set(name, record);
    readOnlyIn.delete(name);
    const keys = plainEnvKeys(native);
    if (keys.length > 0) plainEnv.set(name, keys);
  }
  for (const [name, other] of shared) {
    if (!services.has(name) && !readOnly.has(name)) { readOnly.set(name, `it is defined in ${other}; ${where(other)}`); readOnlyIn.set(name, other); }
  }
  return { file, text, doc, ifVersion: hash, services, readOnly, readOnlyIn, plainEnv };
}

/** Make sure the change log can be appended to before anything is changed, so no change goes unlogged. */
const openLog = (changeLog: string): Refusal | undefined => {
  try {
    closeSync(openSync(changeLog, 'a', 0o600));
    return undefined;
  }
  catch (error) {
    return refuse('CHANGE_LOG_UNWRITABLE', `cannot append to the change log ${changeLog}: ${(error as Error).message}; nothing was changed`);
  }
};

interface LogLine {
  readonly at: string;
  readonly principal: string;
  readonly op: string;
  readonly name: string;
  readonly before: ServiceRecord | null;
  readonly after: ServiceRecord | null;
  readonly fileHashBefore: string | null;
  readonly fileHashAfter: string | null;
  /** An acknowledge's files and the hashes it named. */
  readonly files?: Readonly<Record<string, string>>;
  readonly refused?: { readonly code: RefusalCode; readonly message: string };
}

const writeLog = (changeLog: string, line: Omit<LogLine, 'at'>): void => {
  appendFileSync(changeLog, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, { mode: 0o600 });
};

/**
 * Replace `file` with `text` atomically, unless its bytes are no longer the
 * version `expect` names (somebody edited it while this request ran), in which
 * case nothing is replaced and `false` comes back. A symlinked file is written
 * through to its target, so the link stays a link.
 */
function writeAtomic(file: string, text: string, expect: string): boolean {
  const target = realpathSync(file);
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  const fd = openSync(temp, 'wx', statSync(target).mode & 0o777);
  try {
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    }
    finally {
      closeSync(fd);
    }
    if (sha256(readFileSync(target)) !== expect) {
      unlinkSync(temp);
      return false;
    }
    renameSync(temp, target);
    return true;
  }
  catch (error) {
    try { unlinkSync(temp); } catch { /* already renamed or never made */ }
    throw error;
  }
}

/** The keys an entry's `environment:` sets, as a mapping or a `KEY=value` list; never their values. */
function plainEnvKeys(entry: unknown): string[] {
  const env = (entry as { environment?: unknown } | null)?.environment;
  if (Array.isArray(env)) return env.map((item) => String(item).split('=')[0] ?? '').filter((key) => key !== '');
  if (env !== null && typeof env === 'object') return Object.keys(env);
  return [];
}

/**
 * The refusal for a version that is not the file's, with the difference when the driver holds the version read.
 *
 * `redact` blanks every `environment:` / `env_cmds:` value on both sides before diffing (@cto 7af7ed84): a remote
 * caller is answered with the redacted diff, and the change log, which is sent off the machine as a backup, always
 * keeps the redacted one. A side that cannot be redacted gives no diff at all.
 */
function stale(state: Pick<State, 'file' | 'ifVersion' | 'text'>, ifVersion: unknown, seen: unknown, redact: boolean): Refusal {
  const old = typeof seen === 'string' && sha256(seen) === ifVersion ? seen : versions.get(String(ifVersion));
  const head = `${state.file} has changed since version ${String(ifVersion)}; it is now ${state.ifVersion}. Nothing was written; read it again`;
  if (old === undefined) return refuse('STALE_VERSION', `${head} (this driver no longer holds the version you read, so it cannot show what changed)`);
  const from = redact ? redactEnv(old) : old;
  const to = redact ? redactEnv(state.text) : state.text;
  if (from === undefined || to === undefined) return refuse('STALE_VERSION', `${head} (the difference cannot be shown without its environment values, so it is left out)`);
  const diff = lineDiff(from, to, `${state.file} @ ${String(ifVersion).slice(0, 12)}`, `${state.file} @ ${state.ifVersion.slice(0, 12)}`);
  return refuse('STALE_VERSION', `${head}. What changed:\n${diff}`, diff);
}

/** Reload process-compose from the files; a refusal naming what it said, or nothing when it reloaded. */
async function reload(machine: Machine, file: string, hash: string): Promise<Refusal | undefined> {
  const [method, path] = ROUTES.reload();
  try {
    const answer = await pcRequest(machine.pc, method, path);
    if (answer.status === 200) return undefined;
    return refuse('RELOAD_FAILED', `written to ${file} (now ${hash}) but not applied: ${pcFailure(answer)}`);
  }
  catch (error) {
    return refuse('RELOAD_FAILED', `written to ${file} (now ${hash}) but not applied: ${(error as Error).message}`);
  }
}

/** `list`: every service the driver can edit, every one it cannot and why, and the version to write against. */
export function listServices(machine: Machine): Answer<Listing> {
  try {
    const state = readState(machine);
    return {
      ok: true,
      services: [...state.services.values()].map((record) => {
        const keys = state.plainEnv.get(record.name);
        return keys ? { ...record, plainEnv: keys.map((key) => `${key} (plain value, set in ${state.file})`) } : record;
      }),
      readOnly: [...state.readOnly].map(([name, reason]) => ({ name, reason })),
      capabilities: CAPABILITIES,
      ifVersion: state.ifVersion,
      file: state.file,
      hashes: fileHashes(machine),
    };
  }
  catch (error) {
    if (error instanceof FileError) return refuse('FILE_UNREADABLE', error.message);
    return failed(error);
  }
}

/** Every `-f` file's hash, remembering each text so a later stale acknowledge can show what changed. */
const fileHashes = (machine: Machine): Record<string, string> => Object.fromEntries(machine.files.map((one) => {
  const file = resolve(one);
  const { text, hash } = readText(file);
  remember(hash, text);
  return [file, hash];
}));

/** An acknowledge's arguments: the hash of each file as the caller was shown it, and optionally the text it read. */
export interface AcknowledgeParams {
  readonly hashes: Readonly<Record<string, string>>;
  readonly seen?: Readonly<Record<string, string>>;
}

/**
 * `acknowledge` (@cto 876bcedd): accept the files as they are now, so drift stops
 * alerting on a change made outside the driver. It is pinned to the hashes the
 * caller was shown: a file that has changed since is refused with the difference
 * (blanked for a remote caller, and always blanked in the log, as a stale put is),
 * and then nothing is recorded. It writes no file and touches nothing running;
 * `record` keeps each accepted hash where drift reads it. A remote caller may
 * acknowledge: it records that someone saw the edit, it does not apply it.
 */
export function acknowledgeFiles(
  machine: Machine, caller: Caller, params: AcknowledgeParams, record: (file: string, hash: string) => void,
): Answer<{ files: Record<string, string> }> {
  const given = params?.hashes;
  const asked = given !== null && typeof given === 'object' ? Object.entries(given).map(([file, hash]) => [resolve(file), hash] as const) : [];
  const log = (refused?: Refusal): void => writeLog(machine.changeLog, {
    principal: caller.principal, op: 'acknowledge', name: '', before: null, after: null, fileHashBefore: null, fileHashAfter: null,
    files: Object.fromEntries(asked.map(([file, hash]) => [file, String(hash)])),
    ...(refused ? { refused: { code: refused.code, message: refused.message } } : {}),
  });
  try {
    const unwritable = openLog(machine.changeLog);
    if (unwritable) return unwritable;
    const files = new Set(machine.files.map((one) => resolve(one)));
    if (asked.length === 0) {
      const refusal = refuse('INVALID', `acknowledge needs "hashes": each -f file's hash as list answered it (${[...files].join(', ')})`);
      log(refusal);
      return refusal;
    }
    for (const [file, hash] of asked) {
      if (!files.has(file) || typeof hash !== 'string') {
        const refusal = refuse('INVALID', `${file} is not one of this machine's -f files (${[...files].join(', ')}), or its hash is not a string`);
        log(refusal);
        return refusal;
      }
    }
    for (const [file, hash] of asked) {
      let now: { text: string; hash: string };
      try {
        now = readText(file);
      }
      catch (error) {
        const refusal = refuse('FILE_UNREADABLE', (error as Error).message);
        log(refusal);
        return refusal;
      }
      remember(now.hash, now.text);
      if (now.hash !== hash) {
        const current = { file, ifVersion: now.hash, text: now.text };
        const seen = params.seen?.[file];
        log(stale(current, hash, seen, true));
        return stale(current, hash, seen, caller.remote);
      }
    }
    for (const [file, hash] of asked) record(file, hash as string);
    log();
    return { ok: true, files: Object.fromEntries(asked) as Record<string, string> };
  }
  catch (error) {
    return failed(error);
  }
}

/** A put's arguments: the record's changed fields, the version it was made against, and optionally that version's text. */
export interface PutParams {
  readonly service: ServicePatch;
  /**
   * The file's sha256 as read, or `"absent"` to create only: a restore sends that, so a name the file
   * already has (editable or read-only) is refused EXISTS rather than overwritten, whatever version it is now.
   */
  readonly ifVersion: string;
  /** The file text the caller read, so a stale put can be shown the difference even after a restart. */
  readonly seen?: string;
}

/** The `ifVersion` that makes a put create-only. */
export const ABSENT = 'absent';

/** A command this put would have the machine run that it did not run before. */
const newCommand = (before: ServiceRecord | undefined, after: ServiceRecord): boolean => {
  if (before === undefined || before.command !== after.command) return true;
  const exec = (record: ServiceRecord): string | undefined => (record.health && 'exec' in record.health ? record.health.exec : undefined);
  return exec(after) !== undefined && exec(after) !== exec(before);
};

/**
 * `put`: create or change one service in the machine's file, then reload.
 *
 * A remote caller that adds an entry, changes its command, or sets a new
 * readiness command is refused while `allowRemoteCommands` is off; a switch
 * file that cannot be read refuses the request with its own message.
 *
 * `ifVersion: "absent"` (#38277 slice 3b, @cto c89ade9c) creates only. It is
 * checked against the file as it is now, so no stale check applies; the write
 * is still pinned to that version, so an edit landing during it is refused as
 * any put's is. A new entry is a new command, so the switch still decides.
 */
export async function putService(machine: Machine, caller: Caller, params: PutParams): Promise<Answer<{ ifVersion: string; file: string; service: ServiceRecord; changed: boolean }>> {
  const name = typeof params?.service?.name === 'string' ? params.service.name : '';
  let before: ServiceRecord | undefined;
  /** The record the put asked for, once it is known to be one; a refusal logs it too. */
  let intended: ServiceRecord | null = null;
  let hashBefore: string | null = null;
  const done = (refusal: Refusal, hashAfter: string | null = hashBefore, logged: Refusal = refusal): Refusal => {
    writeLog(machine.changeLog, {
      principal: caller.principal, op: 'put', name, before: before ?? null, after: intended, fileHashBefore: hashBefore, fileHashAfter: hashAfter,
      refused: { code: logged.code, message: logged.message },
    });
    return refusal;
  };
  try {
    const unwritable = openLog(machine.changeLog);
    if (unwritable) return unwritable;
    let state: State;
    try {
      state = readState(machine);
    }
    catch (error) {
      if (error instanceof FileError) return done(refuse('FILE_UNREADABLE', error.message));
      throw error;
    }
    hashBefore = state.ifVersion;
    before = state.services.get(name);
    const invalid = checkPatch(params?.service);
    if (invalid) return done(refuse(invalid.code, invalid.message));
    const reason = state.readOnly.get(name);
    const createOnly = params.ifVersion === ABSENT;
    if (createOnly && (before !== undefined || reason !== undefined)) {
      return done(refuse('EXISTS', `${name} already exists in ${state.readOnlyIn.get(name) ?? state.file}; a restore never overwrites`));
    }
    if (reason !== undefined) return done(refuse('READ_ONLY', `${name} is read-only here: ${reason}`));
    if (before === undefined && params.service.command === undefined) return done(refuse('INVALID', `${name} is a new service, so it needs a command`));
    const after = applyPatch(before, params.service);
    intended = after;
    if (!createOnly && params.ifVersion !== state.ifVersion) return done(stale(state, params.ifVersion, params.seen, caller.remote), hashBefore, stale(state, params.ifVersion, params.seen, true));
    if (caller.remote && newCommand(before, after)) {
      let allowed: boolean;
      try {
        allowed = machineSwitches(machine.configDir).allowRemoteCommands;
      }
      catch (error) {
        return done(refuse('SWITCHES_UNREADABLE', (error as Error).message));
      }
      if (!allowed) return done(refuse('REMOTE_COMMANDS_OFF', REMOTE_COMMANDS_OFF));
    }
    let text: string;
    try {
      const changes = nativeChanges(before, after);
      text = before === undefined ? addEntry(state.text, state.doc, name, changes) : editEntry(state.text, state.doc, name, changes);
    }
    catch (error) {
      if (error instanceof LayoutError) {
        return done(refuse('UNSUPPORTED_LAYOUT', `${error.message} in ${state.file}; edit it in ${state.file} on ${machine.name}`));
      }
      throw error;
    }
    if (text === state.text) {
      writeLog(machine.changeLog, { principal: caller.principal, op: 'put', name, before: before ?? null, after, fileHashBefore: hashBefore, fileHashAfter: hashBefore });
      return { ok: true, ifVersion: state.ifVersion, file: state.file, service: after, changed: false };
    }
    // The edit must read back as exactly the record it was meant to write, or nothing is written.
    const check = parseDocument(text);
    const entry = check.errors.length === 0 ? processesOf(check)?.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === name) : undefined;
    const readBack = entry ? fromNative(name, isMap(entry.value) ? entry.value.toJSON() : entry.value) : 'it is missing after the edit';
    if (!same(readBack, after)) {
      return done(failed(new Error(`the edit to ${name} did not read back as the record (${typeof readBack === 'string' ? readBack : JSON.stringify(readBack)}); nothing was written`)));
    }
    if (!writeAtomic(state.file, text, state.ifVersion)) {
      return done(refuse('STALE_VERSION', `${state.file} changed while this put ran; nothing was written; read it again`));
    }
    const hashAfter = sha256(text);
    remember(hashAfter, text);
    const reloadRefusal = await reload(machine, state.file, hashAfter);
    if (reloadRefusal) return done(reloadRefusal, hashAfter);
    writeLog(machine.changeLog, { principal: caller.principal, op: 'put', name, before: before ?? null, after, fileHashBefore: hashBefore, fileHashAfter: hashAfter });
    return { ok: true, ifVersion: hashAfter, file: state.file, service: after, changed: true };
  }
  catch (error) {
    const refusal = failed(error);
    try { return done(refusal); } catch { return refusal; }
  }
}

/** `remove`: take one service out of the machine's file, then reload. Removing runs nothing, so it needs no switch. */
export async function removeService(machine: Machine, caller: Caller, params: { readonly name: string; readonly ifVersion: string; readonly seen?: string }): Promise<Answer<{ ifVersion: string; file: string }>> {
  const name = typeof params?.name === 'string' ? params.name : '';
  let before: ServiceRecord | undefined;
  let hashBefore: string | null = null;
  const done = (refusal: Refusal, hashAfter: string | null = hashBefore, logged: Refusal = refusal): Refusal => {
    writeLog(machine.changeLog, {
      principal: caller.principal, op: 'remove', name, before: before ?? null, after: null, fileHashBefore: hashBefore, fileHashAfter: hashAfter,
      refused: { code: logged.code, message: logged.message },
    });
    return refusal;
  };
  try {
    const unwritable = openLog(machine.changeLog);
    if (unwritable) return unwritable;
    let state: State;
    try {
      state = readState(machine);
    }
    catch (error) {
      if (error instanceof FileError) return done(refuse('FILE_UNREADABLE', error.message));
      throw error;
    }
    hashBefore = state.ifVersion;
    before = state.services.get(name);
    const reason = state.readOnly.get(name);
    if (reason !== undefined) return done(refuse('READ_ONLY', `${name} is read-only here: ${reason}`));
    if (before === undefined) return done(refuse('NOT_FOUND', `${name} is not a service in ${state.file}`));
    if (params.ifVersion !== state.ifVersion) return done(stale(state, params.ifVersion, params.seen, caller.remote), hashBefore, stale(state, params.ifVersion, params.seen, true));
    let text: string;
    try {
      text = removeEntry(state.text, state.doc, name);
    }
    catch (error) {
      if (error instanceof LayoutError) return done(refuse('UNSUPPORTED_LAYOUT', `${error.message} in ${state.file}; edit it in ${state.file} on ${machine.name}`));
      throw error;
    }
    if (!writeAtomic(state.file, text, state.ifVersion)) {
      return done(refuse('STALE_VERSION', `${state.file} changed while this remove ran; nothing was written; read it again`));
    }
    const hashAfter = sha256(text);
    remember(hashAfter, text);
    const reloadRefusal = await reload(machine, state.file, hashAfter);
    if (reloadRefusal) return done(reloadRefusal, hashAfter);
    writeLog(machine.changeLog, { principal: caller.principal, op: 'remove', name, before, after: null, fileHashBefore: hashBefore, fileHashAfter: hashAfter });
    return { ok: true, ifVersion: hashAfter, file: state.file };
  }
  catch (error) {
    const refusal = failed(error);
    try { return done(refusal); } catch { return refusal; }
  }
}

const currentHash = (machine: Machine): string | null => {
  const last = machine.files[machine.files.length - 1];
  try {
    return last === undefined ? null : sha256(readFileSync(resolve(last)));
  }
  catch {
    // The hash is context in the log line only; a control call does not read the file.
    return null;
  }
};

/**
 * `start`, `stop` or `restart` one process. These run nothing new, so they work
 * whatever `allowRemoteCommands` says. Stopping a scheduled process pauses its
 * schedule until it is started again (process-compose's rule).
 */
export async function controlService(machine: Machine, caller: Caller, params: { readonly name: string; readonly verb: 'start' | 'stop' | 'restart' }): Promise<Answer<{ name: string }>> {
  const name = typeof params?.name === 'string' ? params.name : '';
  const verb = params?.verb;
  const hash = currentHash(machine);
  const line = (refused?: Refusal): void => writeLog(machine.changeLog, {
    principal: caller.principal, op: String(verb), name, before: null, after: null, fileHashBefore: hash, fileHashAfter: hash,
    ...(refused ? { refused: { code: refused.code, message: refused.message } } : {}),
  });
  try {
    const unwritable = openLog(machine.changeLog);
    if (unwritable) return unwritable;
    if (verb !== 'start' && verb !== 'stop' && verb !== 'restart') {
      const refusal = refuse('INVALID', `verb must be start, stop or restart, not ${String(verb)}`);
      line(refusal);
      return refusal;
    }
    if (name === '') {
      const refusal = refuse('INVALID', 'name must be a service name');
      line(refusal);
      return refusal;
    }
    const [method, path] = ROUTES[verb](name);
    let refusal: Refusal | undefined;
    try {
      const answer = await pcRequest(machine.pc, method, path);
      if (answer.status !== 200) refusal = refuse('PC_REFUSED', `${verb} ${name}: ${pcFailure(answer)}`);
    }
    catch (error) {
      refusal = refuse('PC_REFUSED', `${verb} ${name}: ${(error as Error).message}`);
    }
    line(refusal);
    return refusal ?? { ok: true, name };
  }
  catch (error) {
    const refusal = failed(error);
    try { line(refusal); } catch { /* the refusal still reaches the caller */ }
    return refusal;
  }
}

/** The most lines one `logs` call returns: one bounded read inside Hightea's ten-second round trip. */
export const LOG_LINES_MAX = 1000;

/**
 * `logs`: one bounded read of a process's log, `limit` lines ending `endOffset`
 * lines from the newest (0 = the newest). A read changes nothing, so only a
 * refusal is logged.
 */
export async function serviceLogs(machine: Machine, caller: Caller, params: { readonly name: string; readonly endOffset?: number; readonly limit?: number }): Promise<Answer<{ name: string; lines: readonly string[] }>> {
  const name = typeof params?.name === 'string' ? params.name : '';
  const endOffset = params?.endOffset ?? 0;
  const limit = params?.limit ?? 100;
  const refused = (refusal: Refusal): Refusal => {
    try {
      writeLog(machine.changeLog, {
        principal: caller.principal, op: 'logs', name, before: null, after: null, fileHashBefore: null, fileHashAfter: null,
        refused: { code: refusal.code, message: refusal.message },
      });
    }
    catch { /* the refusal still reaches the caller */ }
    return refusal;
  };
  try {
    if (name === '') return refused(refuse('INVALID', 'name must be a service name'));
    if (!Number.isInteger(endOffset) || endOffset < 0) return refused(refuse('INVALID', 'endOffset must be a whole number of lines'));
    if (!Number.isInteger(limit) || limit < 1 || limit > LOG_LINES_MAX) return refused(refuse('INVALID', `limit must be 1 to ${LOG_LINES_MAX} lines`));
    const [method, path] = ROUTES.logs(name, endOffset, limit);
    let answer;
    try {
      answer = await pcRequest(machine.pc, method, path);
    }
    catch (error) {
      return refused(refuse('PC_REFUSED', `logs ${name}: ${(error as Error).message}`));
    }
    if (answer.status !== 200) return refused(refuse('PC_REFUSED', `logs ${name}: ${pcFailure(answer)}`));
    const logs = (answer.body as { logs?: unknown } | undefined)?.logs;
    if (!Array.isArray(logs) || logs.some((one) => typeof one !== 'string')) {
      return refused(refuse('PC_REFUSED', `logs ${name}: process-compose answered without a list of lines: ${JSON.stringify(answer.body)}`));
    }
    return { ok: true, name, lines: logs as string[] };
  }
  catch (error) {
    return refused(failed(error));
  }
}

/** The most bytes one read of the change log answers: one bounded read per round trip (@cto 720ff22b). */
export const CHANGES_BYTES_MAX = 256 * 1024;

/** What a read of the change log answers in place of a line that is not a JSON object: where it is and how long, never its text. */
export interface UnreadableLine {
  readonly unreadable: true;
  readonly offset: number;
  readonly bytes: number;
}

/** Whether a line read from the change log is the marker for one that could not be read. */
export const isUnreadableLine = (line: Record<string, unknown>): line is Record<string, unknown> & UnreadableLine =>
  line['unreadable'] === true && typeof line['offset'] === 'number' && typeof line['bytes'] === 'number';

/** A byte range of the change log, as AHP's `resourceRead` asks it: from `position`, at most `length` bytes. */
export interface ChangesRange {
  readonly position?: number;
  readonly length?: number;
}

/** What one read of the change log answers. */
export interface Changes {
  /**
   * The log's identity: its device, inode and creation time. It changes when the file is replaced or rotated,
   * and is empty while no change has been made on this machine yet.
   */
  readonly log: string;
  /** The byte the read started at: the `position` asked for. */
  readonly position: number;
  /** The byte after the last whole line answered: where the next read starts. */
  readonly end: number;
  /** The log's size now, in bytes. */
  readonly size: number;
  /** The whole lines in `[position, end)`, each parsed; a line that is not a JSON object is an {@link UnreadableLine}. */
  readonly lines: ReadonlyArray<Record<string, unknown>>;
}

/** Fill `buffer` from `position`; answers how many bytes there were (fewer when the file is shorter than asked). */
const readAt = (fd: number, buffer: Buffer, position: number): number => {
  let filled = 0;
  while (filled < buffer.length) {
    const got = readSync(fd, buffer, filled, buffer.length - filled, position + filled);
    if (got === 0) break;
    filled += got;
  }
  return filled;
};

/** The byte offset of the first newline at or after `from`, or -1 when the rest of the file has none. */
const nextNewline = (fd: number, from: number, size: number): number => {
  const chunk = Buffer.alloc(64 * 1024);
  for (let at = from; at < size;) {
    const got = readAt(fd, chunk.subarray(0, Math.min(chunk.length, size - at)), at);
    if (got === 0) return -1;
    const found = chunk.subarray(0, got).indexOf(0x0a);
    if (found >= 0) return at + found;
    at += got;
  }
  return -1;
};

/**
 * One read of the change log (#38277, @cto 720ff22b): the whole lines from
 * `position`, cut at the last newline at or before `position + length` (length
 * at most CHANGES_BYTES_MAX), with the log's identity and where the next read
 * starts. A byte position is the log's own addressing, which AHP's
 * `resourceRead` carries; there is no cursor of ours.
 *
 * `log` is the identity the caller holds, when it holds one. A changed identity,
 * or a position past the end, is refused CHANGES_REPLACED, never restarted from
 * 0 on the caller's behalf: the caller takes a fresh listing and reads the new
 * log from 0. A trailing line with no newline yet is a write in progress and
 * waits for the next read. One line longer than the bound is answered alone, so
 * a reader always moves past it. It reads only.
 */
export function changesAt(machine: Machine, range: ChangesRange = {}, log?: string): Answer<Changes> {
  const file = machine.changeLog;
  const position = range.position ?? 0;
  const length = Math.min(range.length ?? CHANGES_BYTES_MAX, CHANGES_BYTES_MAX);
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
    return refuse('INVALID', 'position and length must be whole numbers of 0 or more');
  }
  const again = 'take a fresh listing and read the new log from 0';
  let fd: number;
  try {
    fd = openSync(file, 'r');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return refuse('FILE_UNREADABLE', `cannot read the change log ${file}: ${(error as Error).message}`);
    // No change has been made on this machine yet: nothing to answer, and no error (@cto c89ade9c).
    if ((log !== undefined && log !== '') || position > 0) return refuse('CHANGES_REPLACED', `the change log ${file} is gone; ${again}`);
    return { ok: true, log: '', position: 0, end: 0, size: 0, lines: [] };
  }
  try {
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile()) return refuse('FILE_UNREADABLE', `the change log ${file} is not a regular file`);
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
    const size = Number(stat.size);
    if (log !== undefined && log !== '' && log !== identity) {
      return refuse('CHANGES_REPLACED', `the change log ${file} was replaced (it is another file now); ${again}`);
    }
    if (position > size) {
      return refuse('CHANGES_REPLACED', `position ${position} is past the end of the change log ${file} (${size} bytes); ${again}`);
    }
    const window = Buffer.alloc(Math.min(size - position, length));
    const held = window.subarray(0, readAt(fd, window, position));
    // A line that is not a JSON object (a crash mid-append leaves one) is answered as a marker and the read goes on
    // (@cto f7a8801f): stopping there would leave every later change unread until someone noticed. Its text is
    // never sent: what it holds is unknown.
    const parse = (bytes: Buffer, at: number): Record<string, unknown> => {
      let value: unknown;
      try {
        value = JSON.parse(bytes.toString('utf8'));
      }
      catch {
        value = undefined;
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return { unreadable: true, offset: at, bytes: bytes.length } satisfies UnreadableLine;
      return value as Record<string, unknown>;
    };
    const lines: Array<Record<string, unknown>> = [];
    let next = 0;
    for (;;) {
      const newline = held.indexOf(0x0a, next);
      if (newline < 0) break;
      lines.push(parse(held.subarray(next, newline), position + next));
      next = newline + 1;
    }
    let end = position + next;
    if (lines.length === 0 && held.length === length && length > 0) {
      const newline = nextNewline(fd, position + held.length, size);
      if (newline >= 0) {
        const long = Buffer.alloc(newline - position);
        lines.push(parse(long.subarray(0, readAt(fd, long, position)), position));
        end = newline + 1;
      }
    }
    return { ok: true, log: identity, position, end, size, lines };
  }
  catch (error) {
    if (error instanceof FileError) return refuse('FILE_UNREADABLE', error.message);
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === 'string') return refuse('FILE_UNREADABLE', `cannot read the change log ${file}: ${(error as Error).message}`);
    return failed(error);
  }
  finally {
    closeSync(fd);
  }
}
