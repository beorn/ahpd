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
import { mkdirSync } from 'node:fs';
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

/** Where a link leads, resolved from the entry that holds it: it has to land inside the release. */
const linkStaysInside = (entryName: string, target: string, topDir: string): boolean => {
  if (target === '' || target.startsWith('/') || target.includes('\\')) return false;
  const parts: string[] = [];
  for (const part of `${entryName}/${target}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.length > 1 && parts[0] === topDir;
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
    const target = entry.target;
    if (target === undefined) throw new Error('archive entry ' + entry.name + ' is a link with no target');
    if (!linkStaysInside(entry.name, target, topDir))
      throw new Error('archive entry ' + entry.name + ' links to ' + target + ', which is outside the release');
  }
  return entries;
};

/**
 * Verify the whole archive, then write it: `strip` drops the one top directory that was checked, `preservePaths`
 * stays false so nothing can escape the staging directory, and no owner is restored.
 */
export const unpackArchive = (archive: string, into: string, topDir: string): readonly string[] => {
  const entries = checkArchive(listArchive(archive), topDir);
  mkdirSync(into, { recursive: true });
  tarLib.x({
    file: archive,
    cwd: into,
    sync: true,
    strip: 1,
    preservePaths: false,
    preserveOwner: false,
    noChmod: false,
  });
  return entries.map((entry) => entry.name);
};
