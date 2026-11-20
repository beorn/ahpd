/**
 * The host's custody of one seat's ACP child, kept after the child exits (#34599).
 *
 * hab hands the host a prefix (`HAB_ACP_PID_PREFIX`) and proves a hosted seat's child ended from what the host keeps
 * there. Two files, both private to hab and this host:
 *
 * - `<prefix>.custody`: one JSON record, written only by the host and only while it holds the lock, each write one
 *   atomic replace. It names the boot, this host process, this opening, a sequence number, the state (`spawning`,
 *   `running`, `ended`) and the child as its pid and raw `/proc/<pid>/stat` text (the stamped parent and birth hab's
 *   orphan check reads). It is kept through `ended`: the moment a child dies is the moment a stop needs its record.
 * - `<prefix>.lock`: one flock(2), never deleted or replaced (deleting a flock file breaks exclusion). An opening
 *   holds it from admission until it has recorded its own child's end; hab's stop holds it across its final read and
 *   its `stopped` commit. The descriptor is close-on-exec, so no child inherits it.
 *
 * Admission never blocks the event loop: the predecessor's `ended` handler, which releases the lock, runs on this
 * same loop. A failed write is reported and never manufactures `ended`.
 */
import { randomUUID } from 'node:crypto';
import { fstatSync, lstatSync, readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '@bearly/durable-file';
import { tryAcquireFlock } from '@bearly/flock';
import type { FlockHandle } from '@bearly/flock';
import { messageOf } from './common.js';

export type CustodyState = 'spawning' | 'running' | 'ended';
export interface CustodyIdentity { readonly pid: number; readonly stat: string }
interface HostServiceSession { readonly sessionId: string; readonly generation: number }
export interface CustodySpawnGuard {
  readonly kind: 'inherited-fd-v1';
  readonly path: string;
  readonly device: string;
  readonly inode: string;
}
export interface CustodyRecord {
  readonly v: 1;
  readonly bootId: string;
  readonly host: CustodyIdentity;
  /** Non-secret service identity projected by hab's verified host preparation, never the identity token. */
  readonly serviceSession?: HostServiceSession;
  readonly opening: string;
  readonly seq: number;
  readonly state: CustodyState;
  readonly child: CustodyIdentity | null;
  readonly spawnGuard?: CustodySpawnGuard;
}

/** How long between two lock tries while a predecessor or a stop holds custody. */
const RETRY_MS = 25;

export const bootId = (): string => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const statOf = (pid: number): string => readFileSync(`/proc/${pid}/stat`, 'utf8');

/** The kernel birth (field 22) of a raw stat text, past the parenthesised command, which may hold spaces. */
const birthOf = (stat: string): string | undefined => stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
const pidOf = (stat: string): number | undefined => {
  const pid = Number(stat.slice(0, stat.indexOf(' ')));
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
};

const identity = (value: unknown): CustodyIdentity | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { pid, stat } = value as { pid?: unknown; stat?: unknown };
  return typeof pid === 'number' && typeof stat === 'string' && pidOf(stat) === pid ? { pid, stat } : undefined;
};

const serviceSessionOf = (value: unknown): HostServiceSession | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { sessionId, generation } = value as { sessionId?: unknown; generation?: unknown };
  return typeof sessionId === 'string' && sessionId.length > 0 && typeof generation === 'number'
    && Number.isSafeInteger(generation) && generation > 0 ? { sessionId, generation } : undefined;
};

/** The adapter has already verified the signed identity. The daemon receives only this projection. */
function hostServiceSession(provider: string): HostServiceSession | undefined {
  const text = process.env.HAB_ACP_HOST_SERVICE_IDENTITY;
  if (text === undefined) return undefined;
  try {
    const identity = serviceSessionOf(JSON.parse(text) as unknown);
    if (identity !== undefined) return identity;
  } catch { /* The diagnostic below covers invalid JSON as well as an invalid shape. */ }
  console.error(`${provider}: invalid HAB_ACP_HOST_SERVICE_IDENTITY; custody records will not prove service-restart continuity`);
  return undefined;
}

/** One read of the record: absent, malformed (any field missing, wrong or inconsistent), or the record. */
export function readCustody(prefix: string): CustodyRecord | 'absent' | 'malformed' {
  let text: string;
  try { text = readFileSync(`${prefix}.custody`, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'malformed';
    raw = parsed as Record<string, unknown>;
  }
  catch { return 'malformed'; }
  const host = identity(raw.host);
  const child = raw.child === null ? null : identity(raw.child);
  const serviceSession = raw.serviceSession === undefined ? undefined : serviceSessionOf(raw.serviceSession);
  const guard = raw.spawnGuard as Partial<CustodySpawnGuard> | undefined;
  if (guard !== undefined && (guard === null || typeof guard !== 'object' || guard.kind !== 'inherited-fd-v1'
    || guard.path !== `${prefix}.spawn-${String(raw.opening)}.lock`
    || typeof guard.device !== 'string' || !/^\d+$/.test(guard.device)
    || typeof guard.inode !== 'string' || !/^\d+$/.test(guard.inode))) return 'malformed';
  if (raw.serviceSession !== undefined && serviceSession === undefined) return 'malformed';
  if (raw.v !== 1 || typeof raw.bootId !== 'string' || raw.bootId === '' || host === undefined
    || typeof raw.opening !== 'string' || raw.opening === '' || typeof raw.seq !== 'number' || !Number.isSafeInteger(raw.seq)
    || (raw.state !== 'spawning' && raw.state !== 'running' && raw.state !== 'ended') || child === undefined
    || (raw.state === 'running' && child === null)) return 'malformed';
  return { v: 1, bootId: raw.bootId, host, ...(serviceSession === undefined ? {} : { serviceSession }),
    opening: raw.opening, seq: raw.seq, state: raw.state, child,
    ...(guard === undefined ? {} : { spawnGuard: guard as CustodySpawnGuard }) };
}

/** Whether a recorded child is proved gone: no live process at its pid with its recorded birth. */
const childGone = (child: CustodyIdentity): boolean => {
  let live: string;
  try { live = statOf(child.pid); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const recorded = birthOf(child.stat);
  return recorded === undefined ? false : birthOf(live) !== recorded;
};

/** Under custody ownership only: a qualified unstamped attempt never received initialize. */
function reconcileSpawning(prefix: string, record: CustodyRecord | 'absent' | 'malformed', boot: string, provider: string): CustodyRecord | 'absent' | 'malformed' {
  if (typeof record !== 'object' || record.bootId !== boot || record.state !== 'spawning' || record.spawnGuard === undefined || !childGone(record.host)) return record;
  const guard = record.spawnGuard;
  let held: FlockHandle | null = null;
  try {
    held = tryAcquireFlock(guard.path, { create: false, noFollow: true });
    if (held === null) return record;
    const fd = fstatSync(held.fd, { bigint: true });
    const path = lstatSync(guard.path, { bigint: true });
    if (!path.isFile() || String(fd.dev) !== guard.device || String(fd.ino) !== guard.inode
      || path.dev !== fd.dev || path.ino !== fd.ino) throw new Error('original guard inode is missing or replaced');
    const fresh = readCustody(prefix);
    if (typeof fresh !== 'object' || fresh.opening !== record.opening || fresh.seq !== record.seq
      || fresh.bootId !== boot || fresh.state !== 'spawning' || fresh.child !== null
      || fresh.host.pid !== record.host.pid || fresh.host.stat !== record.host.stat
      || JSON.stringify(fresh.spawnGuard) !== JSON.stringify(guard) || !childGone(fresh.host)) {
      throw new Error('guard occurrence changed during reconciliation');
    }
    const ended: CustodyRecord = { ...fresh, seq: fresh.seq + 1, state: 'ended', child: null };
    atomicWriteFileSync(`${prefix}.custody`, `${JSON.stringify(ended)}\n`);
    return ended;
  } catch (error) {
    throw new Error(`${provider}: no new ACP child: original spawn guard cannot prove retirement: ${messageOf(error)}`, { cause: error });
  } finally { held?.release(); }
}

/** Why an existing record forbids a new spawn under the lock, or undefined when it allows one. */
function forbids(record: CustodyRecord | 'absent' | 'malformed', boot: string): string | undefined {
  if (record === 'absent') return undefined;
  if (record === 'malformed') return 'its custody record is unreadable, so nothing proves an earlier child ended';
  if (record.bootId !== boot || record.state === 'ended') return undefined;
  if (record.state === 'spawning') return `opening ${record.opening} was admitted and never recorded its child, so a child may be alive`;
  if (record.child !== null && childGone(record.child)) return undefined;
  return `child ${String(record.child?.pid)} of opening ${record.opening} is still alive`;
}

/** One opening's custody: the lock it holds and the record it writes. */
export interface Custody {
  readonly opening: string;
  readonly spawnGuard?: CustodySpawnGuard;
  readonly inheritedFd?: number;
  /** Close the host duplicate after the child inherited it at OS spawn. */
  releaseInherited(): void;
  /** Record a state. Returns false, having reported why, when the write did not land. */
  write(state: CustodyState, child: CustodyIdentity | null): boolean;
  /** Record the end of this opening's child (or that it spawned none), then release the lock. */
  end(child: CustodyIdentity | null): void;
  /** Release without recording: only before anything was spawned. */
  release(): void;
  /** The child's identity, read from /proc at bind. */
  identify(pid: number): CustodyIdentity;
}

/**
 * Admit one opening: take the custody lock (retrying on a timer until `boundMs` passes), then decide from the record
 * read under it. Throws when custody is held past the bound or the record forbids a spawn; nothing is written then.
 */
export async function admitCustody(prefix: string, boundMs: number, provider: string, guarded = false): Promise<Custody> {
  const lockPath = `${prefix}.lock`;
  const deadline = Date.now() + boundMs;
  let handle: FlockHandle | null = tryAcquireFlock(lockPath);
  while (handle === null) {
    if (Date.now() >= deadline) {
      throw new Error(`${provider}: ACP custody at ${lockPath} did not become available within ${String(boundMs)} ms (held by another opening, host or stop); nothing was spawned`);
    }
    await new Promise((resolve) => { setTimeout(resolve, RETRY_MS); });
    handle = tryAcquireFlock(lockPath);
  }
  const held = handle;
  let inherited: FlockHandle | null = null;
  try {
    const boot = bootId();
    const before = guarded ? reconcileSpawning(prefix, readCustody(prefix), boot, provider) : readCustody(prefix);
    const why = forbids(before, boot);
    if (why !== undefined) throw new Error(`${provider}: no new ACP child for this seat: ${why}; nothing was spawned`);
    const hostIdentity = { pid: process.pid, stat: statOf(process.pid) };
    const serviceSession = hostServiceSession(provider);
    const opening = randomUUID();
    let spawnGuard: CustodySpawnGuard | undefined;
    if (guarded) {
      const path = `${prefix}.spawn-${opening}.lock`;
      inherited = tryAcquireFlock(path, { noFollow: true, fileMode: 0o600 });
      if (inherited === null) throw new Error(`${provider}: new occurrence guard is already held; nothing was spawned`);
      const stat = fstatSync(inherited.fd, { bigint: true });
      spawnGuard = { kind: 'inherited-fd-v1', path, device: String(stat.dev), inode: String(stat.ino) };
    }
    const inheritedFd = inherited?.fd;
    const releaseInherited = (): void => { inherited?.release(); inherited = null; };
    let seq = typeof before === 'object' ? before.seq : 0;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseInherited();
      held.release();
    };
    const write = (state: CustodyState, child: CustodyIdentity | null): boolean => {
      try {
        const now = readCustody(prefix);
        // A guard against a bug, not the exclusion: after this opening's first write, the record is its own.
        if (seq > (typeof before === 'object' ? before.seq : 0) && (typeof now !== 'object' || now.opening !== opening)) {
          console.error(`${provider}: ACP custody record at ${prefix}.custody is no longer opening ${opening}'s; not writing ${state}`);
          return false;
        }
        seq += 1;
        const record: CustodyRecord = { v: 1, bootId: boot, host: hostIdentity,
          ...(serviceSession === undefined ? {} : { serviceSession }), opening, seq, state, child,
          ...(spawnGuard === undefined ? {} : { spawnGuard }) };
        atomicWriteFileSync(`${prefix}.custody`, `${JSON.stringify(record)}\n`);
        return true;
      }
      catch (error) {
        console.error(`${provider}: could not record ACP custody ${state} at ${prefix}.custody: ${messageOf(error)}`);
        return false;
      }
    };
    return {
      opening,
      ...(spawnGuard === undefined ? {} : { spawnGuard }),
      ...(inheritedFd === undefined ? {} : { inheritedFd }),
      releaseInherited,
      write,
      end: (child) => {
        try { write('ended', child); }
        finally { release(); }
      },
      release,
      identify: (pid) => ({ pid, stat: statOf(pid) }),
    };
  }
  catch (error) {
    inherited?.release();
    held.release();
    throw error;
  }
}
