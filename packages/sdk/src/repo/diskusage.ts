/**
 * What removing a worktree would free: the bytes its regular files take on
 * the volume it is on, as VS Code's host measures one before its window
 * offers the removal.
 *
 * Symbolic links are not followed, a folder on another device is not
 * entered, and a file with hard links counts only when every one of its
 * links is inside the tree: a file linked from outside stays on disk when
 * the tree goes.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/worktreeDiskUsage.ts#L136-L219
 */
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BigIntStats, Dir } from 'node:fs';

/** The two reads a scan makes, which a test stands in for. */
export interface DiskUsageFileSystem {
  lstat(path: string): Promise<BigIntStats>;
  opendir(path: string): Promise<Dir>;
}

const nodeFileSystem: DiskUsageFileSystem = {
  lstat: (path) => lstat(path, { bigint: true }),
  opendir: (path) => opendir(path),
};

/** A scan's stop, said as the abort of its signal. */
export class DiskUsageCancelled extends Error {
  constructor() {
    super('The disk usage measure was cancelled.');
  }
}

const stopIf = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw new DiskUsageCancelled();
};

const missing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const statOf = (path: string, fs: DiskUsageFileSystem): Promise<BigIntStats | undefined> =>
  fs.lstat(path).catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });

/** A file with more than one link, and how many of its links the scan met. */
interface Linked {
  allocated: bigint;
  links: bigint;
  met: bigint;
}

/** The allocated bytes of up to eight files, read at once; linked files go to `linked`. */
const filesOf = async (paths: string[], signal: AbortSignal | undefined, fs: DiskUsageFileSystem, device: bigint, linked: Map<string, Linked>): Promise<bigint> => {
  stopIf(signal);
  const stats = await Promise.all(paths.map((path) => statOf(path, fs).catch(() => undefined)));
  let total = 0n;
  for (const stat of stats) {
    if (stat === undefined || !stat.isFile() || stat.dev !== device) continue;
    if (stat.blocks < 0n) throw new Error('Allocated file size is unavailable');
    // Node reports allocated blocks in 512-byte units, Windows included.
    const allocated = stat.blocks * 512n;
    if (stat.nlink > 1n) {
      const key = `${String(stat.dev)}:${String(stat.ino)}`;
      const seen = linked.get(key);
      if (seen === undefined) linked.set(key, { allocated, links: stat.nlink, met: 1n });
      else {
        seen.met++;
        if (stat.nlink > seen.links) seen.links = stat.nlink;
      }
    }
    else total += allocated;
  }
  return total;
};

/** The reclaimable bytes under `root`, or nothing for a root that is missing or no folder. */
export const measureDiskUsage = async (root: string, signal?: AbortSignal, fs: DiskUsageFileSystem = nodeFileSystem): Promise<number | undefined> => {
  stopIf(signal);
  const top = await statOf(root, fs);
  if (top === undefined || !top.isDirectory() || top.isSymbolicLink()) return undefined;
  const pending = [root];
  const linked = new Map<string, Linked>();
  let total = 0n;
  while (pending.length > 0) {
    stopIf(signal);
    const path = pending.pop() as string;
    if (path !== root) {
      const stat = await statOf(path, fs);
      if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== top.dev) continue;
    }
    const dir = await fs.opendir(path).catch((error: unknown) => {
      if (missing(error)) return undefined;
      throw error;
    });
    if (dir === undefined) continue;
    let files: string[] = [];
    for await (const entry of dir) {
      stopIf(signal);
      const inner = join(path, entry.name);
      if (entry.isDirectory()) pending.push(inner);
      else if (entry.isFile()) {
        files.push(inner);
        if (files.length === 8) {
          total += await filesOf(files, signal, fs, top.dev, linked);
          files = [];
        }
      }
    }
    total += await filesOf(files, signal, fs, top.dev, linked);
  }
  for (const one of linked.values()) if (one.met === one.links) total += one.allocated;
  stopIf(signal);
  const bytes = Number(total);
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Worktree disk usage exceeds the supported byte range');
  return bytes;
};

/** The device, inode and birth time of a folder, which a kept measure is only good for. */
export const identityOf = async (root: string, fs: DiskUsageFileSystem = nodeFileSystem): Promise<string | undefined> => {
  const stat = await statOf(root, fs);
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink() || stat.birthtimeNs <= 0n) return undefined;
  return `${String(stat.dev)}:${String(stat.ino)}:${String(stat.birthtimeNs)}`;
};

/**
 * At most `slots` scans at once, the rest waiting in order, as VS Code's host
 * shares one limit between every connection.
 */
export const slotted = (slots: number): (<T>(work: () => Promise<T>) => Promise<T>) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= slots) await new Promise<void>((resolve) => { waiting.push(resolve); });
    running++;
    try { return await work(); }
    finally {
      running--;
      waiting.shift()?.();
    }
  };
};
