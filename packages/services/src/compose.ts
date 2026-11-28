/**
 * The process-compose driver (#38277): plain functions, no driver SDK,
 * registry or base class (@cto). The AHP method set and `list`'s capability
 * list are the interface. The second supervisor, systemd --user units, is its
 * own functions in systemd.ts; each function here hands a `systemd-user`
 * machine to them, or refuses it by name, before reading anything.
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
  writeFileSync, writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isAlias, isMap, isPair, isScalar, parseDocument, visit, type Document, type Node } from 'yaml';
import { REMOTE_COMMANDS_OFF, machineSwitches } from './switches.js';
import {
  CONDITIONS, FIELDS, LANDING_KEY, MEMORY_KEY, RESTART_POLICIES, applyPatch, bytesOfSize, checkPatch, fromNative, landingConflict, nativeChanges, same,
  type ServicePatch, type ServiceRecord,
} from './record.js';
import { LayoutError, addEntry, editEntry, lineDiff, processesOf, redactEnv, removeEntry } from './splice.js';
import { ROUTES, pcFailure, pcRequest, type PcSocket } from './pc.js';
import { cutCommand, cutReason } from './watch.js';
import { previousSlot } from './cron.js';
import { controlUnit, putUnit, removeUnit, unsupported, type SystemdMachine, type SystemdUserBackend } from './systemd.js';

/** A machine whose services process-compose runs. */
export interface ComposeBackend {
  readonly kind: 'process-compose';
  /** process-compose's `-f` files, in the order given; the last is the one written. */
  readonly files: readonly string[];
  readonly pc: PcSocket;
}

/** One machine's services, as the plugin or the installer that hosts the driver configures it. */
export interface Machine {
  /** The machine's name, as a person reading "edit it in <file> on <machine>" knows it. */
  readonly name: string;
  /** The daemon's config directory, where `machineSwitches` reads `config.json`. */
  readonly configDir: string;
  /** The JSONL change log; created 0600. */
  readonly changeLog: string;
  readonly backend: ComposeBackend | SystemdUserBackend;
}

/** A machine under process-compose: what the drift check and the services plugin take. */
export type ComposeMachine = Machine & { readonly backend: ComposeBackend };

const isCompose = (machine: Machine): machine is ComposeMachine => machine.backend.kind === 'process-compose';
const isSystemd = (machine: Machine): machine is SystemdMachine => machine.backend.kind === 'systemd-user';

/** Who is asking. `remote` is anybody not on this machine (Hightea's pipe included). */
export interface Caller {
  readonly principal: string;
  readonly remote: boolean;
}

export type RefusalCode =
  | 'INVALID' | 'PLAIN_ENV_VALUE' | 'NOT_FOUND' | 'READ_ONLY' | 'STALE_VERSION' | 'REMOTE_COMMANDS_OFF'
  | 'SWITCHES_UNREADABLE' | 'UNSUPPORTED_LAYOUT' | 'FILE_UNREADABLE' | 'RELOAD_FAILED' | 'PC_REFUSED'
  | 'CHANGE_LOG_UNWRITABLE' | 'DRIVER_FAILED' | 'NOT_CONFIGURED' | 'EXISTS' | 'CHANGES_REPLACED'
  | 'NOT_SUPPORTED' | 'SYSTEMCTL_REFUSED';

export interface Refusal {
  readonly ok: false;
  readonly code: RefusalCode;
  readonly message: string;
  /** On STALE_VERSION: what changed between the version the caller read and now, when the driver still holds it. */
  readonly diff?: string;
  /** On SYSTEMCTL_REFUSED: what systemctl printed, as it printed it. */
  readonly output?: string;
}

export type Answer<T> = ({ readonly ok: true } & T) | Refusal;

/** What `list` answers. */
export interface Listing {
  /**
   * Each editable service. `plainEnv` names, read-only, every key the file sets with a plain value
   * ("K (plain value, set in <file>)"); the value itself is never answered (@cto 7af7ed84), and turning
   * one into a secret reference is a person's edit on the machine.
   */
  readonly services: ReadonlyArray<ServiceRecord & { readonly plainEnv?: readonly string[]; readonly reports?: readonly number[] }>;
  readonly readOnly: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
  readonly capabilities: typeof CAPABILITIES;
  readonly ifVersion: string;
  readonly file: string;
  /** The sha256 of every `-f` file, in order: what `acknowledge` is given back to accept a change made outside the driver. */
  readonly hashes: Readonly<Record<string, string>>;
}

/** What this driver can carry. process-compose keeps no last-run time, so a cron slot missed while the driver was down is caught up from the entry's own schedule. */
export const CAPABILITIES = {
  fields: FIELDS,
  schedule: ['cron', 'interval'] as const,
  missedRunCatchup: true,
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
  /** Exit codes an entry declares report-only (`x-hh-reports`): a nonzero exit that is an answer, not a failure. */
  readonly reports: Map<string, number[]>;
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
function sharedNames(machine: ComposeMachine, last: string, lastDoc: Document): Map<string, string> {
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
  for (const file of machine.backend.files.slice(0, -1)) visitFile(resolve(file), 0);
  return names;
}

/** The exit codes an entry declares report-only under `x-hh-reports`, or undefined when it declares none. */
function reportsOf(native: unknown): number[] | undefined {
  if (typeof native !== 'object' || native === null) return undefined;
  const declared = (native as Record<string, unknown>)['x-hh-reports'];
  if (!Array.isArray(declared)) return undefined;
  const codes = declared.filter((one): one is number => typeof one === 'number' && Number.isInteger(one));
  return codes.length === 0 ? undefined : [...codes].sort((a, b) => a - b);
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

function readState(machine: ComposeMachine): State {
  const last = machine.backend.files[machine.backend.files.length - 1];
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
  const reports = new Map<string, number[]>();
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
    const declared = reportsOf(native);
    if (declared !== undefined) reports.set(name, declared);
  }
  for (const [name, other] of shared) {
    if (!services.has(name) && !readOnly.has(name)) { readOnly.set(name, `it is defined in ${other}; ${where(other)}`); readOnlyIn.set(name, other); }
  }
  return { file, text, doc, ifVersion: hash, services, readOnly, readOnlyIn, plainEnv, reports };
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

/** One line of the change log, whichever backend wrote it. */
export interface LogLine {
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
  /** A landing restart's identities and pids: #39156 acceptance A records the old and the new pid. */
  readonly landing?: LandingRestart;
  /** A memory kill: the observed bytes and the cap (#39156 acceptance C). */
  readonly memory?: MemoryKill;
  /** A memory alarm: the observed bytes and the alarm value (#39156 acceptance C). */
  readonly memoryAlarm?: MemoryAlarm;
  /** A slot a scheduled service missed while the driver was down, and whether a run caught it up (#39156 C). */
  readonly missedRun?: MissedRun;
  readonly refused?: { readonly code: RefusalCode; readonly message: string };
}

const writeLog = (changeLog: string, line: Omit<LogLine, 'at'>, at = new Date().toISOString()): void => {
  appendFileSync(changeLog, `${JSON.stringify({ at, ...line })}\n`, { mode: 0o600 });
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
async function reload(machine: ComposeMachine, file: string, hash: string): Promise<Refusal | undefined> {
  const [method, path] = ROUTES.reload();
  try {
    const answer = await pcRequest(machine.backend.pc, method, path);
    if (answer.status === 200) return undefined;
    return refuse('RELOAD_FAILED', `written to ${file} (now ${hash}) but not applied: ${pcFailure(answer)}`);
  }
  catch (error) {
    return refuse('RELOAD_FAILED', `written to ${file} (now ${hash}) but not applied: ${(error as Error).message}`);
  }
}

/** `list`: every service the driver can edit, every one it cannot and why, and the version to write against. */
export function listServices(machine: Machine): Answer<Listing> {
  if (!isCompose(machine)) return unsupported('list', machine);
  try {
    const state = readState(machine);
    return {
      ok: true,
      services: [...state.services.values()].map((record) => {
        const keys = state.plainEnv.get(record.name);
        const reported = state.reports.get(record.name);
        const extra = {
          ...(keys === undefined ? {} : { plainEnv: keys.map((key) => `${key} (plain value, set in ${state.file})`) }),
          ...(reported === undefined ? {} : { reports: reported }),
        };
        return Object.keys(extra).length === 0 ? record : { ...record, ...extra };
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
const fileHashes = (machine: ComposeMachine): Record<string, string> => Object.fromEntries(machine.backend.files.map((one) => {
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
  if (!isCompose(machine)) return unsupported('acknowledge', machine);
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
    const files = new Set(machine.backend.files.map((one) => resolve(one)));
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
  if (isSystemd(machine)) return putUnit(machine, caller, params);
  if (!isCompose(machine)) return unsupported('put', machine);
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
    const conflict = landingConflict(after);
    if (conflict !== undefined) return done(refuse('INVALID', conflict));
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
  if (isSystemd(machine)) return removeUnit(machine, caller, params);
  if (!isCompose(machine)) return unsupported('remove', machine);
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

const currentHash = (machine: ComposeMachine): string | null => {
  const last = machine.backend.files[machine.backend.files.length - 1];
  try {
    return last === undefined ? null : sha256(readFileSync(resolve(last)));
  }
  catch {
    // The hash is context in the log line only; a control call does not read the file.
    return null;
  }
};

/** A service over its alarm value, as the answer reports it. */
export interface MemoryAlarm {
  readonly name: string;
  readonly bytes: number;
  readonly alarmBytes: number;
}

/** A service the driver stopped for passing its kill value. */
export interface MemoryKill {
  readonly name: string;
  readonly bytes: number;
  readonly killBytes: number;
}

/** What one memory check found. */
export interface MemoryReport {
  readonly alarmed: readonly MemoryAlarm[];
  readonly killed: readonly MemoryKill[];
}

/** The memory caps this machine's file names, by service. */
function memoryCapsOf(machine: ComposeMachine): Map<string, { alarmBytes: number; killBytes: number }> {
  const file = machine.backend.files[machine.backend.files.length - 1]!;
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const processes = processesOf(doc);
  const found = new Map<string, { alarmBytes: number; killBytes: number }>();
  for (const item of processes?.items ?? []) {
    const name = isScalar(item.key) ? String(item.key.value) : undefined;
    const entry = item.value;
    if (name === undefined || !isMap(entry)) continue;
    const cap = entry.get(MEMORY_KEY, true);
    if (!isMap(cap)) continue;
    const alarm = cap.get('alarm', true);
    const kill = cap.get('kill', true);
    const alarmBytes = isScalar(alarm) && typeof alarm.value === 'string' ? bytesOfSize(alarm.value) : undefined;
    const killBytes = isScalar(kill) && typeof kill.value === 'string' ? bytesOfSize(kill.value) : undefined;
    if (alarmBytes === undefined || killBytes === undefined) continue;
    found.set(name, { alarmBytes, killBytes });
  }
  return found;
}

const memoryStateFile = (machine: Machine): string => join(machine.configDir, 'memory.json');

/**
 * #39156 acceptance C, the memory half: a per-run cap with an alarm value and a kill value, as host-backup needs
 * (alarm 3G, kill 4G). process-compose reports each process's `mem` and enforces nothing, so the driver reads it:
 * at or above the alarm it records one alert until the process drops back under it, and at or above the kill it
 * stops the process once and records the kill. A service with no `x-hh-memory` is never looked at.
 */
export async function checkMemory(machine: Machine, caller: Caller): Promise<Answer<MemoryReport>> {
  if (!isCompose(machine)) return unsupported('memory', machine);
  try {
    const caps = memoryCapsOf(machine);
    if (caps.size === 0) return { ok: true, alarmed: [], killed: [] };
    const [method, path] = ROUTES.processes();
    const answer = await pcRequest(machine.backend.pc, method, path);
    if (answer.status !== 200) return refuse('PC_REFUSED', `memory: ${pcFailure(answer)}`);
    const data = (answer.body as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(data)) return refuse('DRIVER_FAILED', `memory: GET /processes answered without a list of named processes: ${JSON.stringify(answer.body)}`);
    const bytes = new Map<string, number>();
    for (const one of data as Array<{ name?: unknown; mem?: unknown }>) {
      if (typeof one?.name === 'string' && typeof one.mem === 'number') bytes.set(one.name, one.mem);
    }
    let state: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(memoryStateFile(machine), 'utf8'));
      state = isRecordOfStrings(parsed) ? parsed : {};
    }
    catch {
      state = {};
    }
    const alarmed: MemoryAlarm[] = [];
    const killed: MemoryKill[] = [];
    for (const [name, cap] of caps) {
      const mem = bytes.get(name);
      if (mem === undefined) continue;
      if (mem >= cap.killBytes) {
        if (state[name] === 'kill') continue;
        const stopRoute = ROUTES.stop(name);
        const stopped = await pcRequest(machine.backend.pc, stopRoute[0], stopRoute[1]);
        const report: MemoryKill = { name, bytes: mem, killBytes: cap.killBytes };
        state[name] = 'kill';
        killed.push(report);
        writeLog(machine.changeLog, {
          principal: caller.principal, op: 'memory-kill', name, before: null, after: null,
          fileHashBefore: null, fileHashAfter: null, memory: report,
          ...(stopped.status === 200 ? {} : { refused: { code: 'PC_REFUSED' as const, message: `stop ${name}: ${pcFailure(stopped)}` } }),
        });
        continue;
      }
      if (mem >= cap.alarmBytes) {
        if (state[name] === 'alarm' || state[name] === 'kill') continue;
        const report: MemoryAlarm = { name, bytes: mem, alarmBytes: cap.alarmBytes };
        state[name] = 'alarm';
        alarmed.push(report);
        writeLog(machine.changeLog, {
          principal: caller.principal, op: 'memory-alarm', name, before: null, after: null,
          fileHashBefore: null, fileHashAfter: null, memoryAlarm: report,
        });
        continue;
      }
      delete state[name];
    }
    writeFileSync(memoryStateFile(machine), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, alarmed, killed };
  }
  catch (error) {
    return failed(error);
  }
}

/** A slot a scheduled service missed while the driver was not watching, and the run that answered it. */
export interface MissedRun {
  readonly name: string;
  /** The slot that should have fired, as an instant. */
  readonly slot: string;
  /** The last pass before the gap: the slot is after it, so no pass saw the slot go by. */
  readonly lastSeen: string;
  /** Whether process-compose took the catch-up run; false when it was already running, or refused. */
  readonly ran: boolean;
}

/** What one schedule check found: how many entries are scheduled, and the slots it caught up. */
export interface ScheduleCheck {
  readonly checked: number;
  readonly caughtUp: readonly MissedRun[];
}

const scheduleStateFile = (machine: Machine): string => join(machine.configDir, 'schedule.json');

/** The last pass's time, and the last slot each service was accounted for. */
interface ScheduleState {
  readonly checkedAt?: string;
  readonly runs: Record<string, string>;
}

/** The persisted schedule state; an unreadable file reads as no history, which baselines rather than catches up. */
function readScheduleState(machine: Machine): ScheduleState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(scheduleStateFile(machine), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { runs: {} };
    const held = parsed as Record<string, unknown>;
    const runs = isRecordOfStrings(held['runs']) ? held['runs'] : {};
    return typeof held['checkedAt'] === 'string' ? { checkedAt: held['checkedAt'], runs } : { runs };
  }
  catch {
    return { runs: {} };
  }
}

/**
 * #39156 acceptance C, the catch-up half: a cron slot that passed while the driver was down is run once.
 *
 * process-compose keeps no last-run time, so the driver keeps one: `<configDir>/schedule.json` holds the time of the
 * last pass and, per scheduled service, the last slot that was accounted for. A slot after that pass's time means no
 * pass was running to see it go by, so the scheduler was never asked and the run is made now, once. The first pass
 * for a service only records its slot: a machine never watched has no before, and guessing a run is worse than
 * skipping one. A service already running takes no second run, and a refusal is recorded rather than retried.
 *
 * Only `cron` schedules are caught up. An `interval` has no slot to name, and process-compose counts it from start.
 */
export async function checkSchedules(machine: Machine, caller: Caller, now: Date = new Date()): Promise<Answer<ScheduleCheck>> {
  if (!isCompose(machine)) return unsupported('schedules', machine);
  try {
    const services = readState(machine).services;
    const scheduled = new Map<string, { readonly cron: string; readonly timezone?: string }>();
    for (const [name, record] of services) {
      const schedule = record.schedule;
      if (schedule?.cron !== undefined) {
        scheduled.set(name, { cron: schedule.cron, ...(schedule.timezone === undefined ? {} : { timezone: schedule.timezone }) });
      }
    }
    if (scheduled.size === 0) return { ok: true, checked: 0, caughtUp: [] };
    const stored = readScheduleState(machine);
    const lastSeenAt = stored.checkedAt === undefined ? undefined : Date.parse(stored.checkedAt);
    const runs: Record<string, string> = {};
    const caughtUp: MissedRun[] = [];
    let running: Set<string> | undefined;
    for (const [name, { cron, timezone }] of scheduled) {
      const slot = previousSlot(cron, now, timezone);
      const seen = stored.runs[name];
      if (slot === undefined) { if (seen !== undefined) runs[name] = seen; continue; }
      const at = slot.toISOString();
      if (seen === undefined) { runs[name] = at; continue; }
      if (Date.parse(seen) >= slot.getTime()) { runs[name] = seen; continue; }
      if (lastSeenAt === undefined || !(slot.getTime() > lastSeenAt)) { runs[name] = at; continue; }
      if (running === undefined) {
        const held = await runningNames(machine);
        if (typeof held === 'string') return refuse('PC_REFUSED', `schedules: ${held}`);
        running = held;
      }
      if (running.has(name)) { runs[name] = at; continue; }
      const [method, path] = ROUTES.restart(name);
      const answer = await pcRequest(machine.backend.pc, method, path);
      const ran = answer.status === 200;
      const missedRun: MissedRun = { name, slot: at, lastSeen: stored.checkedAt!, ran };
      caughtUp.push(missedRun);
      runs[name] = at;
      writeLog(machine.changeLog, {
        principal: caller.principal, op: 'schedule-catchup', name, before: null, after: null,
        fileHashBefore: null, fileHashAfter: null, missedRun,
        ...(ran ? {} : { refused: { code: 'PC_REFUSED' as const, message: `catch up ${name} for slot ${at}: ${pcFailure(answer)}` } }),
      });
    }
    writeFileSync(scheduleStateFile(machine), `${JSON.stringify({ checkedAt: now.toISOString(), runs }, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, checked: scheduled.size, caughtUp };
  }
  catch (error) {
    return failed(error);
  }
}

/** The names process-compose reports as running, or the reason it could not be read. */
async function runningNames(machine: ComposeMachine): Promise<Set<string> | string> {
  const [method, path] = ROUTES.processes();
  try {
    const answer = await pcRequest(machine.backend.pc, method, path);
    if (answer.status !== 200) return pcFailure(answer);
    const data = (answer.body as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(data)) return `GET /processes answered without a list of named processes: ${JSON.stringify(answer.body)}`;
    return new Set((data as Array<{ name?: unknown; status?: unknown }>)
      .filter((one) => typeof one?.name === 'string' && String(one.status) === 'Running')
      .map((one) => one.name as string));
  }
  catch (error) {
    return (error as Error).message;
  }
}

/** One resident a promotion restarted (#39156 acceptance A: the old and the new pid are recorded). */
export interface LandingRestart {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly oldPid: number | null;
  readonly newPid: number | null;
  readonly elapsedMs: number;
}

/** What one check found: how many entries name a landing, and the residents it restarted. */
export interface LandingCheck {
  readonly checked: number;
  readonly restarted: readonly LandingRestart[];
}

const landingStateFile = (machine: Machine): string => join(machine.configDir, 'landings.json');

const isRecordOfStrings = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((one) => typeof one === 'string');

/** The identities last seen per service; an unreadable file reads as none, because it holds only a baseline. */
function readLandingState(machine: Machine): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(landingStateFile(machine), 'utf8'));
    return isRecordOfStrings(parsed) ? parsed : {};
  }
  catch {
    return {};
  }
}

/** The landing identities this machine's file names, by service. */
function landingsOf(machine: ComposeMachine): Map<string, string> {
  const file = machine.backend.files[machine.backend.files.length - 1]!;
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const processes = processesOf(doc);
  const found = new Map<string, string>();
  for (const item of processes?.items ?? []) {
    const name = isScalar(item.key) ? String(item.key.value) : undefined;
    const entry = item.value;
    if (name === undefined || !isMap(entry)) continue;
    const landing = entry.get(LANDING_KEY, true);
    if (isScalar(landing) && typeof landing.value === 'string' && landing.value !== '') found.set(name, landing.value);
  }
  return found;
}

/** What the landing points at now: the real path it resolves to, or the link text when it does not resolve. */
function landingIdentity(target: string): string {
  try {
    return realpathSync(target);
  }
  catch {
    return target;
  }
}

/** Every process-compose process and its pid, or the reason it could not be read. */
async function pidsOf(machine: ComposeMachine): Promise<Map<string, number> | string> {
  const [method, path] = ROUTES.processes();
  try {
    const answer = await pcRequest(machine.backend.pc, method, path);
    if (answer.status !== 200) return pcFailure(answer);
    const data = (answer.body as { data?: unknown } | undefined)?.data;
    if (!Array.isArray(data)) return `GET /processes answered without a list of named processes: ${JSON.stringify(answer.body)}`;
    const pids = new Map<string, number>();
    for (const one of data as Array<{ name?: unknown; pid?: unknown }>) {
      if (typeof one?.name === 'string' && typeof one.pid === 'number') pids.set(one.name, one.pid);
    }
    return pids;
  }
  catch (error) {
    return (error as Error).message;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * #39156 acceptance A: a promoted landing restarts the resident, and the old and the new pids are recorded.
 *
 * The identity is where the entry's landing resolves to now, so a promotion reads as a different real path and
 * nothing else counts as one. The first check for a service records the baseline and restarts nothing: a machine
 * never checked has no before to compare. A restart is followed by a bounded wait for a pid that differs, so the
 * recorded new pid is the one process-compose started rather than a guess; when none appears in the window the
 * restart is still recorded, with `newPid: null`, instead of pretending it worked.
 */
export async function checkLandings(
  machine: Machine,
  caller: Caller,
  wait: { readonly pidPollMs?: number; readonly pidTimeoutMs?: number } = {},
): Promise<Answer<LandingCheck>> {
  if (!isCompose(machine)) return unsupported('landings', machine);
  const pollMs = wait.pidPollMs ?? 50;
  const timeoutMs = wait.pidTimeoutMs ?? 5000;
  try {
    const landings = landingsOf(machine);
    if (landings.size === 0) return { ok: true, checked: 0, restarted: [] };
    const state = readLandingState(machine);
    // The common case is nothing moved, and then the driver asks process-compose nothing at all: every tick of a
    // short cadence costs one symlink read per service, not a socket round trip.
    const moved: Array<{ readonly name: string; readonly from: string; readonly to: string }> = [];
    let baselined = false;
    for (const [name, target] of landings) {
      const identity = landingIdentity(target);
      const seen = state[name];
      if (seen === undefined) {
        state[name] = identity;
        baselined = true;
        continue;
      }
      if (seen !== identity) moved.push({ name, from: seen, to: identity });
    }
    const finish = (restarted: readonly LandingRestart[]): Answer<LandingCheck> => {
      if (baselined || restarted.length > 0) writeFileSync(landingStateFile(machine), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      return { ok: true, checked: landings.size, restarted };
    };
    if (moved.length === 0) return finish([]);
    const before = await pidsOf(machine);
    if (typeof before === 'string') return refuse('DRIVER_FAILED', `landings: ${before}`);
    const restarted: LandingRestart[] = [];
    for (const { name, from: seen, to: identity } of moved) {
      const oldPid = before.get(name) ?? null;
      const started = Date.now();
      const [method, path] = ROUTES.restart(name);
      const answer = await pcRequest(machine.backend.pc, method, path);
      if (answer.status !== 200) return refuse('PC_REFUSED', `restart ${name} for a promoted landing: ${pcFailure(answer)}`);
      let newPid: number | null = null;
      const deadline = started + timeoutMs;
      for (;;) {
        const now = await pidsOf(machine);
        const pid = typeof now === 'string' ? undefined : now.get(name);
        if (pid !== undefined && pid !== oldPid) {
          newPid = pid;
          break;
        }
        if (Date.now() >= deadline) break;
        await sleep(pollMs);
      }
      const restart: LandingRestart = { name, from: seen, to: identity, oldPid, newPid, elapsedMs: Date.now() - started };
      restarted.push(restart);
      state[name] = identity;
      writeLog(machine.changeLog, {
        principal: caller.principal, op: 'landing-restart', name, before: null, after: null,
        fileHashBefore: null, fileHashAfter: null, landing: restart,
      });
    }
    return finish(restarted);
  }
  catch (error) {
    return failed(error);
  }
}

/**
 * `start`, `stop` or `restart` one process. These run nothing new, so they work
 * whatever `allowRemoteCommands` says. Stopping a scheduled process pauses its
 * schedule until it is started again (process-compose's rule).
 */
export async function controlService(machine: Machine, caller: Caller, params: { readonly name: string; readonly verb: 'start' | 'stop' | 'restart' }): Promise<Answer<{ name: string; output?: string }>> {
  if (isSystemd(machine)) return controlUnit(machine, caller, params);
  if (!isCompose(machine)) return unsupported(String(params?.verb), machine);
  const name = typeof params?.name === 'string' ? params.name : '';
  const verb = params?.verb;
  const hash = currentHash(machine);
  let requestedAt: string | undefined;
  const line = (refused?: Refusal): void => writeLog(machine.changeLog, {
    principal: caller.principal, op: String(verb), name, before: null, after: null, fileHashBefore: hash, fileHashAfter: hash,
    ...(refused ? { refused: { code: refused.code, message: refused.message } } : {}),
  }, requestedAt);
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
      // The stop may complete before its HTTP acknowledgement lets us append the record.
      requestedAt = new Date().toISOString();
      const answer = await pcRequest(machine.backend.pc, method, path);
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
  if (!isCompose(machine)) return unsupported('logs', machine);
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
      answer = await pcRequest(machine.backend.pc, method, path);
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
  // The systemd-user arm's log goes through its host, which this node-fs read would bypass.
  if (!isCompose(machine)) return unsupported('changes', machine);
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
