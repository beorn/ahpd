/**
 * Unpacking a pinned release archive (#38280).
 *
 * A customer host places a tree that came from the internet, so the archive is read twice. First every entry is listed
 * with node-tar - npm's own reader, which already understands GNU long names, pax headers and hardlinks, and which
 * strips absolute paths and `..` by default - and checked against the policy here: exactly one top directory named
 * after the archive, every entry inside it, no devices or fifos, and no link that resolves outside the release. Only
 * an archive where every entry passes is written at all; one bad entry refuses the whole archive and names it
 * (@cto 2026-11-25).
 *
 * Then it is unpacked with the same reader into a staging directory, modes preserved (exec bits on `bin` and `.node`),
 * ownership never touched. The caller renames that staging tree into `releases/<version>`, so `current` never points at
 * a tree that was not checked first.
 */
import { existsSync, mkdirSync } from 'node:fs';
import * as tarLib from 'tar';

export interface ArchiveEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'symlink' | 'hardlink' | 'other';
  /** Where a link points, exactly as the archive says it. */
  readonly target?: string;
}

const kindOf = (type: string): ArchiveEntry['kind'] =>
  type === 'Directory' ? 'dir' : type === 'File' ? 'file' : type === 'SymbolicLink' ? 'symlink' : type === 'Link' ? 'hardlink' : 'other';

/** Every entry in the archive, in order. Refuses to guess: an entry node-tar cannot read is its own error. */
export const listArchive = (archive: string): readonly ArchiveEntry[] => {
  const entries: ArchiveEntry[] = [];
  tarLib.t({
    file: archive,
    sync: true,
    onentry: (read) => {
      entries.push({
        name: read.path,
        kind: kindOf(read.type),
        ...(read.linkpath === undefined ? {} : { target: read.linkpath }),
      });
    },
  });
  return entries;
};

/** An entry name that is a plain relative path: no absolute, no `..` anywhere, no empty segment tricks. */
const plainRelative = (path: string): boolean => {
  if (path === '' || path.startsWith('/') || path.includes('\\')) return false;
  return !path.split('/').includes('..');
};

/**
 * Where a link leads, and whether that lands inside the release (@cto 2026-11-25).
 *
 * The two link kinds resolve from different places, and getting that wrong is an escape. A symlink's target is
 * relative to the folder the link sits in, so `top/link -> ../x` points BESIDE the release, not at `top/x`. A hard
 * link's target is a path in the archive root, not relative to the entry at all. Both are resolved from their own
 * base, and a hard link that climbs at all is refused outright: nothing in a release needs one, so there is no reason
 * to accept the arithmetic.
 *
 * A symlink may climb inside the release but never past its top folder. That folder is dropped by the `strip: 1` that
 * turns the archive into the release tree, so `top/a -> ../top/b` names a path that does not exist after the strip,
 * and on disk it points beside the release (@dev/6 2026-11-25).
 */
const linkStaysInside = (entry: ArchiveEntry, topDir: string): boolean => {
  const target = entry.target;
  if (target === undefined || target === '' || target.startsWith('/') || target.includes('\\')) return false;
  const fromFolder = entry.kind === 'symlink'
  const parts: string[] = fromFolder ? entry.name.split('/').slice(0, -1) : []
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!fromFolder || parts.length <= 1) return false
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length > 0 && parts[0] === topDir
};

/** The entries, refused as a whole when any one of them is not a safe member of `<topDir>/`. */
export const checkArchive = (entries: readonly ArchiveEntry[], topDir: string): readonly ArchiveEntry[] => {
  if (entries.length === 0) throw new Error('archive has no entries');
  for (const entry of entries) {
    if (!plainRelative(entry.name)) throw new Error('archive entry ' + entry.name + ' is not a relative path without ..');
    if (entry.name !== topDir && !entry.name.startsWith(topDir + '/'))
      throw new Error('archive entry ' + entry.name + ' is outside ' + topDir + '/; the archive must hold exactly one top directory named after it');
    if (entry.kind === 'other')
      throw new Error('archive entry ' + entry.name + ' is a device, fifo or other special file, which this installer does not unpack');
    if (entry.kind !== 'symlink' && entry.kind !== 'hardlink') continue;
    if (entry.target === undefined) throw new Error('archive entry ' + entry.name + ' is a link with no target');
    if (!linkStaysInside(entry, topDir))
      throw new Error('archive entry ' + entry.name + ' links to ' + entry.target + ', which is outside the release');
  }
  return entries;
};

/**
 * Verify the whole archive, then write it: `strip` drops the one top directory that was checked, `preservePaths`
 * stays false so nothing can escape the staging directory, and no owner is restored.
 */
export const unpackArchive = (archive: string, into: string, topDir: string): readonly string[] => {
  const entries = checkArchive(listArchive(archive), topDir);
  // Writing into a tree that already exists merges it into the release: a folder left by an interrupted install would
  // become part of the tree `current` points at, unchecked. The caller clears its own staging path first, so a stuck
  // install recovers on the next run; anything else gets this refusal by name (@dev/6 2026-11-25).
  if (existsSync(into)) throw new Error('staging tree ' + into + ' already exists from an earlier run; remove it');
  mkdirSync(into, { recursive: true });
  tarLib.x({
    file: archive,
    cwd: into,
    sync: true,
    strip: 1,
    preservePaths: false,
    preserveOwner: false,
    noChmod: false,
    // A warning about an entry we could not write is an incomplete release, and a half-written release that reports
    // success is the failure this whole file exists to prevent: any entry node-tar refuses throws instead (@dev/6
    // 2026-11-25). The caller removes the staging tree it was writing into.
    strict: true,
  });
  return entries.map((entry) => entry.name);
};
