/**
 * The one append-only JSONL writer (I19 wave 2, slice 7, the one-jsonl-writer bead).
 *
 * Every hab-side journal — Inhab's condition journal, hab-core's decision log,
 * channel queues and mailboxes, the habcp and stdio tails, the stop audit —
 * appends through here. What used to differ per site is an option, never a
 * fork: file mode, fsync after the write, healing a torn tail first, creating
 * the parent directory. It lives in inhab because inhab has no workspace
 * dependencies and hab-core already depends on it; a writer in hab-core could
 * not be consumed by the condition journal without a cycle.
 *
 * Contract:
 *   - one record is one line: `JSON.stringify(record) + "\n"`, and a batch is
 *     ONE write on an O_APPEND descriptor, so concurrent appenders interleave
 *     whole lines, never bytes (for the sizes these journals carry);
 *   - a crash can tear only the final write, so an unterminated tail is a
 *     crash artifact, never concurrent corruption. `healTornTail` drops that
 *     fragment before appending — otherwise the next append would terminate
 *     it into a corrupt line that every later read throws on. Nothing
 *     complete is lost: every kept line ends in "\n";
 *   - a fragment longer than `maxTornBytes` is refused, loudly, because a
 *     torn line of that size is not what these journals write and healing it
 *     would silently discard something else;
 *   - the readers here split at the LINE level: complete lines come back with
 *     their 1-based line numbers, an unterminated tail comes back as a typed
 *     diagnostic instead of a line, and a complete line that is not JSON
 *     throws by default (NO SILENT ERRORS) or is skipped with a typed
 *     diagnostic when the caller asks. Record-level validation stays each
 *     consumer's own policy.
 */
import { closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, writeSync } from "node:fs"
import { mkdir, open, stat, type FileHandle } from "node:fs/promises"
import { dirname } from "node:path"

export interface AppendJsonlOptions {
  /** Mode for a file this append creates. Default 0o600: journals are private to the habitat user. */
  readonly mode?: number
  /** fsync the descriptor after the write, so the line survives a crash before the effect it journals. Default false. */
  readonly fsync?: boolean
  /** Drop an unterminated tail before appending (see the module contract). Default false. */
  readonly healTornTail?: boolean
  /** The longest fragment `healTornTail` will drop; a longer one throws. Default 64 KiB; `Infinity` never refuses. */
  readonly maxTornBytes?: number
  /** Create the parent directory (mode 0o700) when it is absent. Default false. */
  readonly mkdir?: boolean
}

export interface AppendJsonlReceipt {
  readonly bytesWritten: number
  readonly lines: number
  /** Bytes of torn tail dropped before the append; 0 when the tail was clean or healing was not asked for. */
  readonly tornBytesDropped: number
  /** True when the file did not end in a newline, so this append started its records on a new line (33944). */
  readonly leadingNewline: boolean
}

export interface HealJsonlOptions {
  readonly maxTornBytes?: number
}

export type JsonlLineDiagnostic =
  | {
      readonly kind: "torn"
      /** 1-based line number the fragment would have had. */
      readonly line: number
      readonly bytes: number
      readonly detail: string
    }
  | { readonly kind: "malformed"; readonly line: number; readonly bytes: number; readonly detail: string }
  /**
   * Zero bytes at the start of a line (33944): a power cut can extend a file with zeros past its last write, and the
   * next append then lands after them. The zeros are stripped and reported; a record after them is kept.
   */
  | { readonly kind: "zero-run"; readonly line: number; readonly bytes: number; readonly detail: string }

export interface JsonlLine {
  /** 1-based, counting every newline-terminated segment including blank ones. */
  readonly line: number
  readonly text: string
}

export interface JsonlSplit {
  /** Every complete, non-blank line in file order. */
  readonly lines: readonly JsonlLine[]
  /** The unterminated final fragment, when there is one. */
  readonly torn: JsonlLineDiagnostic | null
  /** Each line's leading zero run, stripped before the line was kept or skipped (33944). */
  readonly zeroRuns: readonly JsonlLineDiagnostic[]
}

export interface ParseJsonlOptions {
  /** What a complete line that is not JSON does: throw (default) or become a diagnostic. */
  readonly onMalformed?: "throw" | "skip"
  /** Named in thrown errors and diagnostics. */
  readonly source?: string
}

export interface JsonlRecord {
  readonly line: number
  readonly value: unknown
}

export interface ParsedJsonl {
  readonly records: readonly JsonlRecord[]
  readonly diagnostics: readonly JsonlLineDiagnostic[]
}

export const DEFAULT_JSONL_MAX_TORN_BYTES = 64 * 1024
const SCAN_CHUNK_BYTES = 64 * 1024
const NEWLINE = 0x0a
const LATEST_JSONL_MAX_LINE_BYTES = 1024 * 1024
// Latest reads never had a whole-file admission cap. Bound their physical
// suffix I/O instead; this is only the snapshot owner's metadata ceiling.
const LATEST_JSONL_MAX_FILE_BYTES = Number.MAX_SAFE_INTEGER
const LATEST_JSONL_MAX_READ_BYTES = LATEST_JSONL_MAX_LINE_BYTES + DEFAULT_JSONL_MAX_TORN_BYTES + SCAN_CHUNK_BYTES

/** Leading NUL characters of a line (33944). */
function leadingZeros(text: string): number {
  let count = 0
  while (count < text.length && text.charCodeAt(count) === 0) count++
  return count
}

/** One line's leading zero run removed (33944), for a caller that walks lines itself; `zeroRun` is null when none. */
export function stripJsonlZeroRun(text: string): {
  readonly text: string
  readonly zeroRun: { readonly bytes: number; readonly detail: string } | null
} {
  const zeros = leadingZeros(text)
  if (zeros === 0) return { text, zeroRun: null }
  const rest = text.slice(zeros)
  return { text: rest, zeroRun: { bytes: zeros, detail: zeroRunDetail(zeros, rest) } }
}

function zeroRunDetail(zeros: number, rest: string): string {
  return rest.trim().length === 0
    ? `${zeros} zero bytes and no record (a power cut extended the file); skipped`
    : `${zeros} zero bytes before a record (a power cut extended the file); stripped, the record kept`
}

function zeroRunDiagnostic(line: number, zeros: number, rest: string): JsonlLineDiagnostic {
  return { kind: "zero-run", line, bytes: zeros, detail: zeroRunDetail(zeros, rest) }
}

/**
 * Paths this process has appended to (33944). After a process's own whole-record append the file ends in a newline,
 * so the last-byte check runs once per path per process, not on every append to a hot log. It assumes nothing else
 * leaves the file unterminated later: another process that crashes mid-append AFTER our first check still has our
 * next record glued onto its fragment, as every append did before 33944.
 */
const newlineCheckedPaths = new Set<string>()

/**
 * Whether an append to `path` must start on a new line: the file exists, is nonempty and does not end in "\n". The
 * check and the append are NOT atomic, and need not be: two processes racing here can each add a newline, and the
 * worst case is one empty line. The line readers here and the hab-core segment followers skip an empty line (a reader
 * that parses every line must do the same). Nothing is ever truncated, so no record can be lost; do not add a lock.
 */
function needsLeadingNewlineSync(path: string): boolean {
  if (newlineCheckedPaths.has(path)) return false
  newlineCheckedPaths.add(path)
  let fd: number
  try {
    fd = openSync(path, "r")
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
  try {
    const size = fstatSync(fd).size
    if (size === 0) return false
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    return last[0] !== NEWLINE
  } finally {
    closeSync(fd)
  }
}

/** The asynchronous twin of {@link needsLeadingNewlineSync}. */
async function needsLeadingNewline(path: string): Promise<boolean> {
  if (newlineCheckedPaths.has(path)) return false
  newlineCheckedPaths.add(path)
  let handle: FileHandle
  try {
    handle = await open(path, "r")
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
  try {
    const { size } = await handle.stat()
    if (size === 0) return false
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    return last[0] !== NEWLINE
  } finally {
    await handle.close()
  }
}

/** One backwards window and line-boundary scan for healing and bounded tail reads. */
function* backwardWindows(
  end: number,
  minimumStart = 0,
  chunkBytes = SCAN_CHUNK_BYTES,
): Generator<{ start: number; length: number }, void> {
  let cursor = end
  while (cursor > minimumStart) {
    const start = Math.max(minimumStart, cursor - chunkBytes)
    yield { start, length: cursor - start }
    cursor = start
  }
}

function lastNewline(bytes: Buffer, before: number = bytes.length): number {
  return before <= 0 ? -1 : bytes.lastIndexOf(NEWLINE, before - 1)
}

export type LatestJsonlLine =
  | { readonly kind: "absent" }
  | { readonly kind: "empty" }
  | { readonly kind: "line"; readonly text: string; readonly offset: number }

/** Read only the last complete nonblank line; never heal the journal. */
export async function readLatestJsonlLine(
  path: string,
  acceptLine?: (line: Extract<LatestJsonlLine, { kind: "line" }>) => boolean,
): Promise<LatestJsonlLine> {
  try {
    let latest: Extract<LatestJsonlLine, { kind: "line" }> | undefined
    const receipt = await readJsonlSnapshotReverse(
      path,
      {
        maxBytes: LATEST_JSONL_MAX_FILE_BYTES,
        maxLineBytes: LATEST_JSONL_MAX_LINE_BYTES,
        // Selection can skip metadata; its physical suffix budget stays the bound.
        maxRows: acceptLine === undefined ? 1 : Number.MAX_SAFE_INTEGER,
        maxWorkingBytes: 16 * 1024 * 1024,
      },
      (record) => {
        const line = { kind: "line" as const, text: record.value as string, offset: record.offset }
        if (acceptLine === undefined || acceptLine(line)) latest = line
      },
      () => latest !== undefined,
      { tornTail: "skip", maxReadBytes: LATEST_JSONL_MAX_READ_BYTES, decodeLine: (text) => text.slice(0, -1) },
    )
    if (receipt.tail !== null && receipt.tail.endExclusive - receipt.tail.start >= DEFAULT_JSONL_MAX_TORN_BYTES) {
      throw new Error(
        `jsonl: unterminated tail at ${path} offset ${receipt.tail.start}; window ${DEFAULT_JSONL_MAX_TORN_BYTES} exhausted`,
      )
    }
    if (latest === undefined && receipt.budgetTruncated === true) {
      throw new Error(
        `jsonl: latest line at ${path} offset ${receipt.bytes - receipt.bytesRead}; window ${LATEST_JSONL_MAX_READ_BYTES} exhausted`,
      )
    }
    return latest ?? { kind: "empty" }
  } catch (error) {
    if (error instanceof JsonlSnapshotError && error.sourceMissing) return { kind: "absent" }
    throw error
  }
}

/** `JSON.stringify(record) + "\n"` per record; a record that serializes to nothing is refused. */
export function serializeJsonlLines(records: readonly unknown[]): string {
  let out = ""
  for (const [index, record] of records.entries()) {
    const line = JSON.stringify(record)
    if (line === undefined) {
      throw new Error(`jsonl: record ${index} serializes to nothing (undefined, a function, or a symbol)`)
    }
    out += `${line}\n`
  }
  return out
}

/** Append records as lines in one write. Synchronous: journal-before-effect steps must not yield. */
export function appendJsonlSync(
  path: string,
  records: readonly unknown[],
  options: AppendJsonlOptions = {},
): AppendJsonlReceipt {
  const payload = serializeJsonlLines(records)
  if (options.mkdir === true) mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tornBytesDropped =
    options.healTornTail === true ? healJsonlTornTailSync(path, { maxTornBytes: options.maxTornBytes }) : 0
  const leadingNewline = options.healTornTail === true ? false : needsLeadingNewlineSync(path)
  const fd = openSync(path, "a", options.mode ?? 0o600)
  try {
    const bytes = Buffer.from(leadingNewline ? `\n${payload}` : payload, "utf8")
    writeAllSync(fd, bytes, path)
    if (options.fsync === true) fsyncSync(fd)
    return { bytesWritten: bytes.byteLength, lines: records.length, tornBytesDropped, leadingNewline }
  } finally {
    closeSync(fd)
  }
}

/** The asynchronous twin of {@link appendJsonlSync}, for callers already on the event loop. */
export async function appendJsonl(
  path: string,
  records: readonly unknown[],
  options: AppendJsonlOptions = {},
): Promise<AppendJsonlReceipt> {
  const payload = serializeJsonlLines(records)
  if (options.mkdir === true) await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tornBytesDropped =
    options.healTornTail === true ? await healJsonlTornTail(path, { maxTornBytes: options.maxTornBytes }) : 0
  const leadingNewline = options.healTornTail === true ? false : await needsLeadingNewline(path)
  const handle = await open(path, "a", options.mode ?? 0o600)
  try {
    const bytes = Buffer.from(leadingNewline ? `\n${payload}` : payload, "utf8")
    let written = 0
    while (written < bytes.byteLength) {
      const result = await handle.write(bytes, written, bytes.byteLength - written)
      if (result.bytesWritten <= 0) throw new Error(`jsonl: append to ${path} wrote nothing`)
      written += result.bytesWritten
    }
    if (options.fsync === true) await handle.sync()
    return { bytesWritten: bytes.byteLength, lines: records.length, tornBytesDropped, leadingNewline }
  } finally {
    await handle.close()
  }
}

/**
 * Drop an unterminated tail. Returns the bytes dropped: 0 when the file is
 * absent, empty, or already ends in "\n". A fragment longer than
 * `maxTornBytes` throws and leaves the file untouched.
 */
export function healJsonlTornTailSync(path: string, options: HealJsonlOptions = {}): number {
  const maxTornBytes = options.maxTornBytes ?? DEFAULT_JSONL_MAX_TORN_BYTES
  let fd: number
  try {
    fd = openSync(path, "r+")
  } catch (error) {
    if (isNotFound(error)) return 0
    throw error
  }
  try {
    const size = fstatSync(fd).size
    if (size === 0) return 0
    const last = Buffer.alloc(1)
    readSync(fd, last, 0, 1, size - 1)
    if (last[0] === NEWLINE) return 0
    for (const { start, length } of backwardWindows(size)) {
      const chunk = Buffer.alloc(length)
      readSync(fd, chunk, 0, chunk.length, start)
      const newlineAt = lastNewline(chunk)
      if (newlineAt !== -1) {
        const cleanEnd = start + newlineAt + 1
        assertTornWithin(path, size - cleanEnd, maxTornBytes)
        ftruncateSync(fd, cleanEnd)
        return size - cleanEnd
      }
      assertTornWithin(path, size - start, maxTornBytes)
      if (start === 0) {
        ftruncateSync(fd, 0)
        return size
      }
    }
    throw new Error(`jsonl: backward scan of ${path} found no bytes in nonempty file`)
  } finally {
    closeSync(fd)
  }
}

/** The asynchronous twin of {@link healJsonlTornTailSync}. */
export async function healJsonlTornTail(path: string, options: HealJsonlOptions = {}): Promise<number> {
  const maxTornBytes = options.maxTornBytes ?? DEFAULT_JSONL_MAX_TORN_BYTES
  const handle = await open(path, "r+").catch((error: unknown) => {
    if (isNotFound(error)) return undefined
    throw error
  })
  if (handle === undefined) return 0
  try {
    const size = (await handle.stat()).size
    if (size === 0) return 0
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    if (last[0] === NEWLINE) return 0
    for (const { start, length } of backwardWindows(size)) {
      const chunk = Buffer.alloc(length)
      await handle.read(chunk, 0, chunk.length, start)
      const newlineAt = lastNewline(chunk)
      if (newlineAt !== -1) {
        const cleanEnd = start + newlineAt + 1
        assertTornWithin(path, size - cleanEnd, maxTornBytes)
        await handle.truncate(cleanEnd)
        return size - cleanEnd
      }
      assertTornWithin(path, size - start, maxTornBytes)
      if (start === 0) {
        await handle.truncate(0)
        return size
      }
    }
    throw new Error(`jsonl: backward scan of ${path} found no bytes in nonempty file`)
  } finally {
    await handle.close()
  }
}

/** Split raw journal text into complete lines plus the torn tail, if any. Blank lines are skipped. */
export function splitJsonlLines(raw: string): JsonlSplit {
  const lines: JsonlLine[] = []
  const zeroRuns: JsonlLineDiagnostic[] = []
  const stripZeros = (line: number, text: string): string => {
    const zeros = leadingZeros(text)
    if (zeros === 0) return text
    const rest = text.slice(zeros)
    zeroRuns.push(zeroRunDiagnostic(line, zeros, rest))
    return rest
  }
  let line = 1
  let cursor = 0
  for (;;) {
    const newline = raw.indexOf("\n", cursor)
    if (newline === -1) break
    const text = stripZeros(line, raw.slice(cursor, newline))
    if (text.trim().length > 0) lines.push({ line, text })
    line += 1
    cursor = newline + 1
  }
  const tail = stripZeros(line, raw.slice(cursor))
  const torn: JsonlLineDiagnostic | null =
    tail.trim().length === 0
      ? null
      : {
          kind: "torn",
          line,
          bytes: Buffer.byteLength(tail, "utf8"),
          detail: "unterminated final fragment (a crash mid-append); skipped, and the next append heals it",
        }
  return { lines, torn, zeroRuns }
}

/** Parse complete lines as JSON; the torn tail and (when asked) malformed lines come back as diagnostics. */
export function parseJsonlLines(raw: string, options: ParseJsonlOptions = {}): ParsedJsonl {
  const source = options.source ?? "jsonl"
  const split = splitJsonlLines(raw)
  const records: JsonlRecord[] = []
  const diagnostics: JsonlLineDiagnostic[] = []
  for (const { line, text } of split.lines) {
    try {
      records.push({ line, value: JSON.parse(text) as unknown })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (options.onMalformed !== "skip") {
        throw new Error(`${source}:${line}: not JSON (${detail})`)
      }
      diagnostics.push({ kind: "malformed", line, bytes: Buffer.byteLength(text, "utf8"), detail })
    }
  }
  diagnostics.push(...split.zeroRuns)
  if (split.torn !== null) diagnostics.push(split.torn)
  return { records, diagnostics }
}

export interface JsonlSnapshotLimits {
  readonly maxBytes: number
  /** Includes the terminating newline. */
  readonly maxLineBytes: number
  readonly maxRows: number
  /** Budget for input buffers and decoded line text; visitor-retained values need their own caller budget. */
  readonly maxWorkingBytes: number
  readonly chunkBytes?: number
}

export interface JsonlSnapshotReceipt {
  readonly source: string
  readonly device: string
  readonly inode: string
  readonly bytes: number
  readonly rows: number
  /** Newline-terminated physical lines, including blank lines skipped by the existing decoder. */
  readonly lines: number
  /** Bytes of an unterminated final fragment dropped under tornTail "skip"; 0 in strict mode or when the tail is blank. */
  readonly tornBytes: number
  /** Zero bytes stripped from the start of lines (33944); each run also went to `onZeroRun` when given. */
  readonly zeroRunBytes: number
  readonly asOf: string
}

export type JsonlSnapshotPhase = "limits" | "open" | "read" | "identity"

/**
 * A snapshot failure. `sourceMissing` is true ONLY when the initial open of the
 * source failed with ENOENT: the one signal that the journal does not exist. A
 * later ENOENT (the source removed mid-read) also fails the snapshot, but the
 * read had already started, so it is not absence.
 */
export class JsonlSnapshotError extends Error {
  readonly snapshotPhase: JsonlSnapshotPhase
  readonly sourceMissing: boolean
  constructor(message: string, phase: JsonlSnapshotPhase, sourceMissing = false) {
    super(message)
    this.snapshotPhase = phase
    this.sourceMissing = sourceMissing
  }
}

/**
 * A caller decodeLine failure: already that caller own diagnostic, so the
 * snapshot propagates it unchanged instead of nesting it under its source
 * prefix. The status journal relies on this to keep its corrupt-condition text.
 */
class JsonlSnapshotRowError extends Error {
  readonly line: number
  constructor(line: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.line = line
  }
}

export interface JsonlSnapshotOptions {
  /** What an unterminated captured final fragment does: refuse (default) or drop it and report tornBytes. */
  readonly tornTail?: "fail" | "skip"
  /**
   * Each line's leading zero run (33944), after it was stripped: a zeros-only line is skipped, a record after the
   * zeros is decoded. The receipt's `zeroRunBytes` counts them either way.
   */
  readonly onZeroRun?: (diagnostic: JsonlLineDiagnostic) => void
  /**
   * Decode one complete nonblank line instead of the default JSON.parse. A
   * thrown error is the caller diagnostic and surfaces unchanged. The second
   * argument stays a forward 1-based line number or a reverse byte offset.
   * Metadata counts raw bytes including LF/CR and cumulative complete physical
   * lines in traversal order, including skipped blanks and the current row.
   */
  readonly decodeLine?: (
    text: string,
    line: number,
    metadata: { readonly offset: number; readonly byteLength: number; readonly linesExamined: number },
  ) => unknown
}

/**
 * Read every recorded row through one descriptor's captured byte boundary, never a tail sample.
 * Required input and malformed lines fail loudly; an unterminated captured
 * fragment fails by default, and under tornTail skip it is dropped with its
 * byte count in the receipt. Under skip, sourceMissing stays the only absence
 * signal and a decodeLine error surfaces exactly as the caller wrote it.
 * The visitor may see rows before a later failure: only the returned receipt certifies a complete snapshot.
 * Appends after capture are excluded. This is not a writer-retirement or future-completeness proof.
 */
export async function readJsonlSnapshot(
  path: string,
  limits: JsonlSnapshotLimits,
  visit: (record: JsonlRecord) => void,
  options: JsonlSnapshotOptions = {},
): Promise<JsonlSnapshotReceipt> {
  const {
    bytesRead: _bytesRead,
    examined: _examined,
    tail: _tail,
    ...receipt
  } = await readJsonlSnapshotCore(path, limits, { kind: "forward", visit }, options)
  return receipt
}

export interface JsonlReverseRecord {
  /** Absolute byte offset of this complete row; its physical line number is unknown. */
  readonly offset: number
  readonly value: unknown
}

export interface JsonlReverseSnapshotOptions extends JsonlSnapshotOptions {
  /** Physical suffix bytes to read, independent of maxBytes' whole-file admissibility check. */
  readonly maxReadBytes?: number
}

export type JsonlReverseSnapshotReceipt = JsonlSnapshotReceipt & {
  /** Complete physical row bytes actually examined, including blanks and the stop row; excludes read-ahead. */
  readonly examined: { readonly start: number; readonly endExclusive: number } | null
  /** Observed unterminated final fragment, separate from complete rows; null when absent or unobserved. */
  readonly tail: { readonly kind: "blank" | "torn"; readonly start: number; readonly endExclusive: number } | null
  readonly bytesRead: number
  /** Present only for an explicitly budgeted read; a partial prefix row is never delivered. */
  readonly budgetTruncated?: boolean
}

/** Read a captured suffix newest first, including the row for which stop returns true.
 * The decoder's numeric location is a byte offset. Limits and identity checks
 * match forward snapshots; rows/lines count only the examined suffix.
 */
export async function readJsonlSnapshotReverse(
  path: string,
  limits: JsonlSnapshotLimits,
  visit: (record: JsonlReverseRecord) => void,
  stop: (record: JsonlReverseRecord) => boolean,
  options: JsonlReverseSnapshotOptions = {},
): Promise<JsonlReverseSnapshotReceipt> {
  return readJsonlSnapshotCore(
    path,
    limits,
    { kind: "reverse", visit, stop, maxReadBytes: options.maxReadBytes },
    options,
  )
}

type JsonlSnapshotTraversal =
  | { readonly kind: "forward"; readonly visit: (record: JsonlRecord) => void }
  | {
      readonly kind: "reverse"
      readonly visit: (record: JsonlReverseRecord) => void
      readonly stop: (record: JsonlReverseRecord) => boolean
      readonly maxReadBytes?: number
    }

async function readJsonlSnapshotCore(
  path: string,
  limits: JsonlSnapshotLimits,
  traversal: JsonlSnapshotTraversal,
  options: JsonlSnapshotOptions,
): Promise<JsonlReverseSnapshotReceipt> {
  const fail = (detail: string, phase: JsonlSnapshotPhase = "read", sourceMissing = false) =>
    new JsonlSnapshotError(`jsonl snapshot ${path}: ${detail}`, phase, sourceMissing)
  const chunkBytes = limits.chunkBytes ?? SCAN_CHUNK_BYTES
  if (
    traversal.kind === "reverse" &&
    traversal.maxReadBytes !== undefined &&
    (!Number.isSafeInteger(traversal.maxReadBytes) || traversal.maxReadBytes < 0)
  ) {
    throw fail(`invalid suffix byte budget ${traversal.maxReadBytes}`, "limits")
  }
  for (const [name, value] of Object.entries({ ...limits, chunkBytes })) {
    const minimum = name === "maxBytes" || name === "maxRows" ? 0 : 1
    if (!Number.isSafeInteger(value) || value < minimum) throw fail(`invalid ${name} limit ${value}`)
  }
  // One byte buffer per chunk/line plus room for UTF-16 decoding and the existing parser's line strings.
  const workspaceBytes = chunkBytes + 5 * limits.maxLineBytes
  if (!Number.isSafeInteger(workspaceBytes) || workspaceBytes > limits.maxWorkingBytes) {
    throw fail(`maxWorkingBytes ${limits.maxWorkingBytes} exceeded by ${workspaceBytes} bytes of line/chunk workspace`)
  }
  const handle = await open(path, "r").catch((error: unknown) => {
    throw fail(`cannot open required input: ${String(error)}`, "open", isNotFound(error))
  })
  try {
    const captured = await handle.stat({ bigint: true })
    const asOf = new Date().toISOString()
    if (!captured.isFile()) throw fail("required input is not a regular file")
    if (captured.size > BigInt(limits.maxBytes)) throw fail(`maxBytes ${limits.maxBytes} exceeded by ${captured.size}`)
    const size = Number(captured.size)
    const reading =
      traversal.kind === "forward"
        ? await readJsonlForwardRows(handle, path, size, limits, chunkBytes, traversal.visit, options)
        : await readJsonlReverseRows(handle, path, size, limits, chunkBytes, traversal, options)
    const final = await handle.stat({ bigint: true })
    const named = await stat(path, { bigint: true })
    if (
      final.dev !== captured.dev ||
      final.ino !== captured.ino ||
      named.dev !== captured.dev ||
      named.ino !== captured.ino
    ) {
      throw fail("source identity changed during snapshot read")
    }
    if (final.size < captured.size) throw fail("source shrank below the captured boundary")
    return {
      source: path,
      device: String(captured.dev),
      inode: String(captured.ino),
      bytes: size,
      ...reading,
      asOf,
    }
  } catch (error) {
    if (error instanceof JsonlSnapshotRowError) throw error
    if (error instanceof JsonlSnapshotError) {
      throw fail(`required snapshot failed: ${String(error)}`, error.snapshotPhase, error.sourceMissing)
    }
    throw fail(`required snapshot failed: ${String(error)}`)
  } finally {
    await handle.close()
  }
}

/** Forward traversal stays in file order; both directions share snapshot certification. */
async function readJsonlForwardRows(
  handle: FileHandle,
  path: string,
  size: number,
  limits: JsonlSnapshotLimits,
  chunkBytes: number,
  visit: (record: JsonlRecord) => void,
  options: JsonlSnapshotOptions,
): Promise<{
  rows: number
  lines: number
  tornBytes: number
  zeroRunBytes: number
  bytesRead: number
  examined: JsonlReverseSnapshotReceipt["examined"]
  tail: JsonlReverseSnapshotReceipt["tail"]
}> {
  const fail = (detail: string) => new JsonlSnapshotError(`jsonl snapshot ${path}: ${detail}`, "read")
  const chunk = Buffer.alloc(chunkBytes)
  const lineBuffer = Buffer.alloc(limits.maxLineBytes)
  let offset = 0
  let lineBytes = 0
  let lineStart = 0
  let line = 1
  let rows = 0
  let tornBytes = 0
  let zeroRunBytes = 0
  // 33944: a line's leading zero run is stripped and reported before the line is decoded or skipped.
  const stripZeros = (raw: string, at: number): string => {
    const zeros = leadingZeros(raw)
    if (zeros === 0) return raw
    const rest = raw.slice(zeros)
    zeroRunBytes += zeros
    options.onZeroRun?.(zeroRunDiagnostic(at, zeros, rest))
    return rest
  }
  while (offset < size) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - offset), offset)
    if (bytesRead === 0) throw fail(`short read before captured boundary at byte ${offset} of ${size}`)
    offset += bytesRead
    for (let index = 0; index < bytesRead; index++) {
      if (lineBytes === limits.maxLineBytes) throw fail(`line ${line}: maxLineBytes ${limits.maxLineBytes} exceeded`)
      const byte = chunk[index]
      if (byte === undefined) throw fail(`missing read byte ${index}`)
      lineBuffer[lineBytes++] = byte
      if (byte !== NEWLINE) continue
      const text = stripZeros(lineBuffer.toString("utf8", 0, lineBytes), line)
      let present = true
      let value: unknown = undefined
      try {
        if (options.decodeLine === undefined) {
          const parsed = parseJsonlLines(text)
          if (parsed.records.length === 0) present = false
          else value = parsed.records[0]?.value
        } else if (text.trim().length === 0) {
          present = false
        } else {
          value = options.decodeLine(text, line, { offset: lineStart, byteLength: lineBytes, linesExamined: line })
        }
      } catch (error) {
        if (options.decodeLine !== undefined) throw new JsonlSnapshotRowError(line, error)
        throw fail(`line ${line}: ${String(error)}`)
      }
      if (present) {
        if (rows === limits.maxRows) throw fail(`maxRows ${limits.maxRows} exceeded at line ${line}`)
        rows++
        visit({ line, value })
      }
      lineStart += lineBytes
      lineBytes = 0
      line++
    }
  }
  if (lineBytes !== 0) {
    // A zeros-only final fragment is a power cut's zero run (33944): reported, never torn. Otherwise unchanged:
    // strict refuses any unterminated bytes; skip drops a nonblank fragment and reports it (splitJsonlLines parity).
    const raw = lineBuffer.toString("utf8", 0, lineBytes)
    const rest = stripZeros(raw, line)
    if (rest.length > 0) {
      if (options.tornTail !== "skip") throw fail(`line ${line}: torn captured row (${lineBytes} unterminated bytes)`)
      tornBytes = rest.trim().length === 0 ? 0 : lineBytes
    }
  }
  return {
    rows,
    lines: line - 1,
    tornBytes,
    zeroRunBytes,
    bytesRead: offset,
    examined: lineStart === 0 ? null : { start: 0, endExclusive: lineStart },
    tail: lineBytes === 0 ? null : { kind: tornBytes === 0 ? "blank" : "torn", start: lineStart, endExclusive: size },
  }
}

/** Shared backward windows locate boundaries before decoding, so split UTF-8
 * codepoints and long rows are joined as bytes and older rows stay unparsed. */
async function readJsonlReverseRows(
  handle: FileHandle,
  path: string,
  size: number,
  limits: JsonlSnapshotLimits,
  chunkBytes: number,
  traversal: Extract<JsonlSnapshotTraversal, { kind: "reverse" }>,
  options: JsonlSnapshotOptions,
): Promise<{
  rows: number
  lines: number
  tornBytes: number
  zeroRunBytes: number
  bytesRead: number
  budgetTruncated?: boolean
  examined: JsonlReverseSnapshotReceipt["examined"]
  tail: JsonlReverseSnapshotReceipt["tail"]
}> {
  const fail = (detail: string) => new JsonlSnapshotError(`jsonl snapshot ${path}: ${detail}`, "read")
  const chunk = Buffer.alloc(chunkBytes)
  const lineBuffer = Buffer.alloc(
    traversal.maxReadBytes === undefined
      ? limits.maxLineBytes
      : Math.min(limits.maxLineBytes, size, traversal.maxReadBytes),
  )
  let start = lineBuffer.length
  let terminated = false
  let rows = 0
  let lines = 0
  let tornBytes = 0
  let zeroRunBytes = 0
  let bytesRead = 0
  let examined: JsonlReverseSnapshotReceipt["examined"] = null
  // 33944: same zero-run policy as the forward reader; the location is the line's byte offset.
  const stripZeros = (raw: string, at: number): string => {
    const zeros = leadingZeros(raw)
    if (zeros === 0) return raw
    const rest = raw.slice(zeros)
    zeroRunBytes += zeros
    options.onZeroRun?.(zeroRunDiagnostic(at, zeros, rest))
    return rest
  }
  let tail: JsonlReverseSnapshotReceipt["tail"] = null
  const complete = (offset: number): boolean => {
    const byteLength = lineBuffer.length - start
    examined = { start: offset, endExclusive: examined?.endExclusive ?? offset + byteLength }
    const text = stripZeros(lineBuffer.toString("utf8", start), offset)
    lines++
    if (text.trim().length === 0) return false
    let value: unknown
    try {
      value =
        options.decodeLine === undefined
          ? parseJsonlLines(text).records[0]?.value
          : options.decodeLine(text, offset, { offset, byteLength, linesExamined: lines })
    } catch (error) {
      if (options.decodeLine !== undefined) throw new JsonlSnapshotRowError(offset, error)
      throw fail(`byte ${offset}: ${String(error)}`)
    }
    if (rows === limits.maxRows) throw fail(`maxRows ${limits.maxRows} exceeded at byte ${offset}`)
    rows++
    const record = { offset, value }
    traversal.visit(record)
    return traversal.stop(record)
  }
  const torn = (): void => {
    const bytes = lineBuffer.length - start
    if (bytes === 0) return
    // Same tail policy as the forward snapshot: a zeros-only fragment is reported, never torn (33944).
    const rest = stripZeros(lineBuffer.toString("utf8", start), size - bytes)
    if (rest.length > 0 && options.tornTail !== "skip") throw fail(`torn captured row (${bytes} unterminated bytes)`)
    const blank = rest.trim().length === 0
    tornBytes = blank ? 0 : bytes
    tail = { kind: blank ? "blank" : "torn", start: size - bytes, endExclusive: size }
  }
  let stopped = false
  const floor = Math.max(0, size - (traversal.maxReadBytes ?? size))
  windows: for (const range of backwardWindows(size, floor, chunkBytes)) {
    let filled = 0
    while (filled < range.length) {
      const read = await handle.read(chunk, filled, range.length - filled, range.start + filled)
      if (read.bytesRead === 0) {
        throw fail(`short read before captured boundary at byte ${range.start + filled} of ${size}`)
      }
      filled += read.bytesRead
      bytesRead += read.bytesRead
    }
    for (let index = range.length - 1; index >= 0; index--) {
      const byte = chunk[index]
      if (byte === undefined) throw fail(`missing read byte ${index}`)
      if (byte === NEWLINE) {
        if (terminated) {
          if (complete(range.start + index + 1)) {
            stopped = true
            break windows
          }
        } else {
          torn()
          terminated = true
        }
        start = lineBuffer.length
      }
      if (start === 0) throw fail(`maxLineBytes ${limits.maxLineBytes} exceeded near byte ${range.start + index}`)
      lineBuffer[--start] = byte
    }
  }
  if (!stopped && floor === 0) {
    if (terminated) complete(0)
    else torn()
  }
  return {
    rows,
    lines,
    tornBytes,
    zeroRunBytes,
    bytesRead,
    examined,
    tail,
    ...(traversal.maxReadBytes === undefined ? {} : { budgetTruncated: !stopped && floor > 0 }),
  }
}

function writeAllSync(fd: number, bytes: Buffer, path: string): void {
  let written = 0
  while (written < bytes.byteLength) {
    const count = writeSync(fd, bytes, written, bytes.byteLength - written)
    if (count <= 0) throw new Error(`jsonl: append to ${path} wrote nothing`)
    written += count
  }
}

function assertTornWithin(path: string, tornBytes: number, maxTornBytes: number): void {
  if (tornBytes > maxTornBytes) {
    throw new Error(
      `jsonl: ${path} ends in an unterminated segment of at least ${tornBytes} bytes, longer than the ${maxTornBytes} a torn line can be; ` +
        "refusing to heal what cannot be a torn line",
    )
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
