/**
 * Drift: what process-compose runs and what the machine's files say, compared
 * (#38277 slice 2, @cto). Drift is reported and never repaired: a difference
 * may be a person's deliberate hand edit, and only a person knows which.
 *
 * Two comparisons:
 *
 * - The names process-compose holds (`GET /processes`) against the names the
 *   `-f` files define. A name only in the files is one process-compose has not
 *   loaded; a name only in process-compose was added in memory, or its file
 *   changed under it.
 * - The sha256 of every `-f` file against the hash the driver last wrote or
 *   acknowledged, kept in a small state file under the plugin's own directory.
 *   A file the state does not know yet is taken as it is (that is the first
 *   check on this machine, and there is nothing to compare it with).
 *
 * Each difference is one alert whose `ref` is `services-drift:<what>`, so the
 * plugin raises it once and clears it when the difference goes. The comparison
 * is a pure function (`compareDrift`); reading the facts and keeping the state
 * file are separate, so the comparison is tested without a timer or a socket.
 */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import type { Machine } from './compose.js';
import { ROUTES, pcFailure, pcRequest } from './pc.js';
import { processesOf } from './splice.js';

/** One alert, in the shape the plugin host's `alert` takes. */
export interface DriftAlert {
  readonly level: 'warning' | 'error';
  readonly text: string;
  readonly ref: string;
}

/** What the comparison reads. Each part is the facts, or the sentence saying why they could not be read. */
export interface DriftFacts {
  /** The machine's name, as the alerts say it. */
  readonly machine: string;
  /** Every process process-compose holds, by name, with its status, and its exit code and restart count when it said them. */
  readonly running: ReadonlyArray<{ readonly name: string; readonly status: string; readonly exitCode?: number; readonly restarts?: number }> | string;
  /** Every process name the `-f` files define, and the file that defines it. */
  readonly defined: ReadonlyMap<string, string> | string;
  /** Each `-f` file's sha256 now, or why it cannot be read. */
  readonly hashes: ReadonlyMap<string, { readonly hash: string } | { readonly error: string }>;
  /** The hash the driver last wrote or acknowledged, by file; or why the state cannot be read. */
  readonly known: Readonly<Record<string, string>> | string;
}

/** The ref prefix every drift alert carries. */
export const DRIFT_REF = 'services-drift:';

const short = (hash: string): string => hash.slice(0, 12);

/**
 * Every difference between what runs and what the files say, as one alert
 * each, in a stable order. No difference is an empty list.
 */
export function compareDrift(facts: DriftFacts): DriftAlert[] {
  const out: DriftAlert[] = [];
  const pc = `process-compose on ${facts.machine}`;
  if (typeof facts.running === 'string') {
    out.push({ level: 'error', ref: `${DRIFT_REF}process-compose`, text: `cannot read what ${pc} runs: ${facts.running}` });
  }
  if (typeof facts.defined === 'string') {
    out.push({ level: 'error', ref: `${DRIFT_REF}files`, text: `cannot read the services the files define on ${facts.machine}: ${facts.defined}` });
  }
  if (typeof facts.running !== 'string' && typeof facts.defined !== 'string') {
    const held = new Map(facts.running.map((one) => [one.name, one.status]));
    for (const [name, file] of [...facts.defined].sort(([a], [b]) => a.localeCompare(b))) {
      if (!held.has(name)) {
        out.push({ level: 'warning', ref: `${DRIFT_REF}not-loaded:${name}`, text: `${name} is defined in ${file} but ${pc} does not hold it; it has not reloaded the files` });
      }
    }
    for (const [name, status] of [...held].sort(([a], [b]) => a.localeCompare(b))) {
      if (!facts.defined.has(name)) {
        out.push({ level: 'warning', ref: `${DRIFT_REF}not-in-files:${name}`, text: `${pc} holds ${name} (${status}), which no -f file defines; it was added in memory or its file changed under it` });
      }
    }
  }
  if (typeof facts.known === 'string') {
    out.push({ level: 'error', ref: `${DRIFT_REF}state`, text: `cannot compare the files' hashes on ${facts.machine}: ${facts.known}` });
  }
  for (const [file, now] of [...facts.hashes].sort(([a], [b]) => a.localeCompare(b))) {
    if ('error' in now) {
      out.push({ level: 'error', ref: `${DRIFT_REF}file:${file}`, text: `cannot read ${file} on ${facts.machine}: ${now.error}` });
      continue;
    }
    if (typeof facts.known === 'string') continue;
    const was = facts.known[file];
    if (was !== undefined && was !== now.hash) {
      out.push({
        level: 'warning',
        ref: `${DRIFT_REF}file:${file}`,
        text: `${file} on ${facts.machine} changed outside the services driver: it is ${short(now.hash)}, last written or acknowledged as ${short(was)}`,
      });
    }
  }
  return out;
}

/** The state file's shape: the hash the driver last wrote or acknowledged, by absolute path. */
interface Saved {
  readonly version: 1;
  readonly files: Record<string, string>;
}

/** The hashes in the state file; none when it is not there yet. Throws, naming the file, when it cannot be read as one. */
export function readKnown(stateFile: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(stateFile, 'utf8');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`cannot read ${stateFile}: ${(error as Error).message}`);
  }
  let held: unknown;
  try {
    held = JSON.parse(text);
  }
  catch {
    throw new Error(`${stateFile} is not JSON`);
  }
  const files = (held as Partial<Saved> | null)?.files;
  if ((held as Partial<Saved> | null)?.version !== 1 || typeof files !== 'object' || files === null || Array.isArray(files)
    || Object.values(files).some((one) => typeof one !== 'string')) {
    throw new Error(`${stateFile} is not a services drift state (version 1, files of hashes)`);
  }
  return { ...files };
}

/** Replace the state file whole: temp file, fsync, rename, owner-only. */
const writeKnown = (stateFile: string, files: Record<string, string>): void => {
  mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
  const temp = join(dirname(stateFile), `.drift.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  const fd = openSync(temp, 'wx', 0o600);
  try {
    try {
      writeSync(fd, `${JSON.stringify({ version: 1, files } satisfies Saved, null, 2)}\n`);
      fsyncSync(fd);
    }
    finally {
      closeSync(fd);
    }
    renameSync(temp, stateFile);
  }
  catch (error) {
    try { unlinkSync(temp); } catch { /* already renamed or never made */ }
    throw error;
  }
};

/**
 * Record `hash` as the version of `file` the driver wrote or a person
 * acknowledged, so it is no longer drift. The services methods call it after
 * each write; the deploy driver (#38276) calls it after it writes a shared file.
 */
export function acknowledge(stateFile: string, file: string, hash: string): void {
  writeKnown(stateFile, { ...readKnown(stateFile), [resolve(file)]: hash });
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The process names one file defines, each with its `replicas` when the file sets it, and the file its top-level
 * `extends` names (resolved beside it), if any.
 */
const namesIn = (file: string): { names: { name: string; replicas?: number }[]; parent?: string } => {
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const error = doc.errors[0];
  if (error) throw new Error(`${file} is not YAML: ${error.message.split('\n')[0]}`);
  const names = (processesOf(doc)?.items ?? []).flatMap((pair) => {
    if (!isScalar(pair.key)) return [];
    const replicas = isMap(pair.value) ? pair.value.get('replicas') : undefined;
    return [{ name: String(pair.key.value), ...(typeof replicas === 'number' ? { replicas } : {}) }];
  });
  const parent = doc.get('extends');
  return typeof parent === 'string' ? { names, parent: resolve(dirname(file), parent) } : { names };
};

/**
 * Every process name the `-f` files (and the files they extend) define, with the last file to define it, as
 * process-compose merges them. A program with `replicas` above 1 is held as `<name>-0` … `<name>-<n-1>` (#38277,
 * seen on process-compose 1.122.0), so it is named that way here; the last file to set `replicas` decides.
 */
function definedNames(machine: Machine): Map<string, string> {
  const defined = new Map<string, string>();
  const replicas = new Map<string, number>();
  const read = (file: string, depth: number, seen: Set<string>): void => {
    if (seen.has(file) || depth > 8) return;
    seen.add(file);
    const { names, parent } = namesIn(file);
    if (parent !== undefined) read(parent, depth + 1, seen);
    for (const one of names) {
      defined.set(one.name, file);
      if (one.replicas !== undefined) replicas.set(one.name, one.replicas);
    }
  };
  for (const file of machine.files) read(resolve(file), 0, new Set());
  const held = new Map<string, string>();
  for (const [name, file] of defined) {
    const count = replicas.get(name) ?? 1;
    if (count > 1) for (let at = 0; at < count; at++) held.set(`${name}-${at}`, file);
    else held.set(name, file);
  }
  return held;
}

/** Read every fact the comparison needs: process-compose over its socket, the files, and the state file. Never throws. */
export async function driftFacts(machine: Machine, stateFile: string): Promise<DriftFacts> {
  let running: DriftFacts['running'];
  try {
    const [method, path] = ROUTES.processes();
    const answer = await pcRequest(machine.pc, method, path);
    const data = (answer.body as { data?: unknown } | undefined)?.data;
    if (answer.status !== 200) running = pcFailure(answer);
    else if (!Array.isArray(data) || data.some((one) => typeof (one as { name?: unknown })?.name !== 'string')) {
      running = `GET /processes answered without a list of named processes: ${JSON.stringify(answer.body)}`;
    }
    else {
      running = data.map((one: { name: string; status?: unknown; exit_code?: unknown; restarts?: unknown }) => ({
        name: one.name,
        status: String(one.status ?? 'unknown'),
        ...(typeof one.exit_code === 'number' ? { exitCode: one.exit_code } : {}),
        ...(typeof one.restarts === 'number' ? { restarts: one.restarts } : {}),
      }));
    }
  }
  catch (error) {
    running = (error as Error).message;
  }
  let defined: DriftFacts['defined'];
  try {
    defined = definedNames(machine);
  }
  catch (error) {
    defined = (error as Error).message;
  }
  const hashes = new Map<string, { hash: string } | { error: string }>();
  for (const file of machine.files.map((one) => resolve(one))) {
    try {
      hashes.set(file, { hash: sha256(readFileSync(file)) });
    }
    catch (error) {
      hashes.set(file, { error: (error as Error).message });
    }
  }
  let known: DriftFacts['known'];
  try {
    known = readKnown(stateFile);
  }
  catch (error) {
    known = (error as Error).message;
  }
  return { machine: machine.name, running, defined, hashes, known };
}

/**
 * One drift check: read the facts, take any file the state does not know yet
 * as it is now, and answer the alerts. Never throws; a state file that cannot
 * be written is one more alert.
 */
export async function checkDrift(machine: Machine, stateFile: string, seen: (facts: DriftFacts) => void = () => {}): Promise<DriftAlert[]> {
  const facts = await driftFacts(machine, stateFile);
  // What the check read, for a reader that shows it (the services channel's rows): one read of process-compose, not two.
  seen(facts);
  const alerts = compareDrift(facts);
  if (typeof facts.known !== 'string') {
    const unknown = [...facts.hashes].filter(([file, now]) => 'hash' in now && (facts.known as Record<string, string>)[file] === undefined);
    if (unknown.length > 0) {
      try {
        writeKnown(stateFile, { ...facts.known, ...Object.fromEntries(unknown.map(([file, now]) => [file, (now as { hash: string }).hash])) });
      }
      catch (error) {
        alerts.push({ level: 'error', ref: `${DRIFT_REF}state`, text: `cannot write ${stateFile}: ${(error as Error).message}` });
      }
    }
  }
  return alerts;
}
