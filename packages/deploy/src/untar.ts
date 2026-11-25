/**
 * Unpacking a pinned release archive (#38280, @cto 2026-11-25).
 *
 * A customer host places a tree that came from the internet, so the archive is read twice: every entry is listed and
 * checked first, and only an archive where every entry is safe is written at all. One absolute path, one `..`, one
 * device or fifo, or one link that points outside the release refuses the whole archive and names the entry that did
 * it. Nothing is written before that pass finishes.
 *
 * The layout is the one @cto ruled: exactly one top-level directory, named after the archive without `.tar.gz`, the
 * way node and VS Code server ship. Its contents become the release tree; the directory itself is not kept.
 */
import { chmodSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

export interface ArchiveEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'symlink' | 'hardlink';
  /** Where a link points, exactly as the header says it. */
  readonly target?: string;
  readonly mode: number;
  readonly offset: number;
  readonly size: number;
}

const field = (block: Buffer, from: number, length: number): string =>
  block.subarray(from, from + length).toString('utf8').replace(/\0[\s\S]*$/u, '');
const octal = (block: Buffer, from: number, length: number): number =>
  Number.parseInt(field(block, from, length).trim() || '0', 8);

const TYPE_NAMES: Readonly<Record<string, string>> = {
  '1': 'hardlink',
  '2': 'symlink',
  '3': 'character device',
  '4': 'block device',
  '5': 'directory',
  '6': 'fifo',
  '7': 'contiguous file',
  x: 'pax header',
  g: 'pax global header',
  L: 'long name',
  K: 'long link name',
};

/** Every entry in the archive, in order; a truncated archive or an entry this installer cannot unpack is refused. */
export const listArchive = (bytes: Uint8Array): readonly ArchiveEntry[] => {
  const entries: ArchiveEntry[] = [];
  let at = 0;
  while (at + BLOCK <= bytes.length) {
    const header = Buffer.from(bytes.subarray(at, at + BLOCK));
    if (header.every((one) => one === 0)) break;
    const prefix = field(header, 345, 155);
    const name = prefix === '' ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`;
    const typeflag = String.fromCharCode(header[156] ?? 0);
    const size = octal(header, 124, 12);
    const mode = octal(header, 100, 8);
    const target = field(header, 157, 100);
    const offset = at + BLOCK;
    const next = offset + Math.ceil(size / BLOCK) * BLOCK;
    if (next > bytes.length) throw new Error(`archive entry ${name} runs past the end of the archive`);
    const kind =
      typeflag === '5' ? 'dir' : typeflag === '2' ? 'symlink' : typeflag === '1' ? 'hardlink' : typeflag === '0' || typeflag === '\0' ? 'file' : undefined;
    if (kind === undefined)
      throw new Error(`archive entry ${name} is a ${TYPE_NAMES[typeflag] ?? `type ${typeflag}`}, which this installer does not unpack`);
    entries.push({ name, kind, mode, offset, size, ...(target === '' ? {} : { target }) });
    at = next;
  }
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
  return normalize(join(dirname(entryName), target)).startsWith(topDir + '/');
};

/** The entries, refused as a whole when any one of them is not a safe member of `<topDir>/`. */
export const checkArchive = (entries: readonly ArchiveEntry[], topDir: string): readonly ArchiveEntry[] => {
  if (entries.length === 0) throw new Error('archive has no entries');
  for (const entry of entries) {
    if (!plainRelative(entry.name)) throw new Error('archive entry ' + entry.name + ' is not a relative path without ..');
    if (entry.name !== topDir && !entry.name.startsWith(`${topDir}/`))
      throw new Error(`archive entry ${entry.name} is outside ${topDir}/; the archive must hold exactly one top directory named after it`);
    if (entry.kind !== 'symlink' && entry.kind !== 'hardlink') continue;
    const target = entry.target;
    if (target === undefined) throw new Error(`archive entry ${entry.name} is a link with no target`);
    if (!linkStaysInside(entry.name, target, topDir))
      throw new Error('archive entry ' + entry.name + ' links to ' + target + ', which is outside the release');
  }
  return entries;
};

/**
 * Verify the whole archive, then write it. Modes are preserved so `bin` and native `.node` files keep their exec bits;
 * ownership is never touched, because the tree is written as the user running the install.
 */
export const unpackArchive = (archive: string, into: string, topDir: string): readonly string[] => {
  const bytes = gunzipSync(readFileSync(archive));
  const entries = checkArchive(listArchive(bytes), topDir);
  mkdirSync(into, { recursive: true });
  const written: string[] = [];
  for (const entry of entries) {
    const inside = entry.name === topDir ? '' : entry.name.slice(topDir.length + 1);
    const path = inside === '' ? into : join(into, inside);
    if (entry.kind === 'dir') {
      mkdirSync(path, { recursive: true });
      chmodSync(path, entry.mode & 0o777);
    } else if (entry.kind === 'file') {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(bytes.subarray(entry.offset, entry.offset + entry.size)));
      chmodSync(path, entry.mode & 0o777);
    } else if (entry.kind === 'symlink') {
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(entry.target as string, path);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      linkSync(join(into, normalize(join(dirname(inside), entry.target as string))), path);
    }
    written.push(path);
  }
  return written;
};
