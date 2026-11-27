// One deterministic tar: fixed order, one mtime, zero ownership, one top folder (#38280).
//
// The customer host release is cut on two machines, and one of them is a stock Mac: no GNU tar, no gzip binary,
// no package manager of its own. This writer is plain Node/Bun, so the packing step needs nothing installed, and it
// fixes the three things GNU tar's flags used to fix - order (sorted walk), time (`mtime`) and owner (0/0) - so two
// runs over the same tree produce the same bytes.
//
// The shape is what the installer reads with node-tar: ustar headers, a pax `path` record only when a name cannot be
// split across the ustar prefix and name fields, a pax `linkpath` record when a link target cannot fit the 100-byte
// ustar field, symlinks kept as symlinks, and directory entries ending in `/`.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BLOCK = 512;

const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;

const splitName = (name) => {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', name };
  for (let at = name.lastIndexOf('/'); at > 0; at = name.lastIndexOf('/', at - 1)) {
    const prefix = name.slice(0, at);
    const rest = name.slice(at + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { prefix, name: rest };
  }
  return null;
};

const header = ({ name, prefix, mode, size, mtime, type, link }) => {
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(mode & 0o7777, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(mtime, 12), 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');
  block.write(type, 156, 1, 'ascii');
  block.write(link ?? '', 157, 100, 'utf8');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
};

const pad = (length) => Buffer.alloc((BLOCK - (length % BLOCK)) % BLOCK, 0);

/**
 * One pax extended-header record: `LENGTH key=value\n`, where LENGTH counts its own digits. GNU tar refuses a header
 * without it ("Malformed extended header: missing length"), and a reader that tolerates it still drops the record.
 */
const paxRecord = (key, value) => {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  for (;;) {
    const next = Buffer.byteLength(`${length}${body}`);
    if (next === length) return `${length}${body}`;
    length = next;
  }
};

/** Every entry under `dir`, in sorted order, skipping whole subtrees named in `exclude`. */
export const tarEntries = (dir, { exclude = [] } = {}) => {
  // A pattern matches at any depth, the way GNU tar --exclude does: node_modules/.bin covers every
  // copy pnpm keeps in its store, not only the one at the stage root.
  const skipped = (relative) =>
    exclude.some(
      (one) =>
        relative === one ||
        relative.startsWith(one + '/') ||
        relative.endsWith('/' + one) ||
        relative.includes('/' + one + '/'),
    );
  const entries = [];
  const walk = (current, relative) => {
    for (const name of readdirSync(current).sort()) {
      const child = relative === '' ? name : `${relative}/${name}`;
      if (skipped(child)) continue;
      const path = join(current, name);
      const stat = lstatSync(path);
      entries.push({
        path,
        relative: stat.isDirectory() ? `${child}/` : child,
        mode: stat.mode,
        mtime: stat.mtimeMs,
        size: stat.isFile() ? stat.size : 0,
        type: stat.isSymbolicLink() ? '2' : stat.isDirectory() ? '5' : '0',
        link: stat.isSymbolicLink() ? readlinkSync(path) : undefined,
      });
      if (stat.isDirectory()) walk(path, child);
    }
  };
  walk(dir, '');
  return entries;
};

/** The tar bytes for one tree: `prefix` replaces the folder `dir` is named after, as `--transform` used to. */
export const writeTar = (dir, { prefix, mtime, exclude = [] }) => {
  const seconds = Math.floor(mtime.getTime() / 1000);
  // The top folder is its own entry, as GNU tar wrote it: a reader that counts the archive's roots sees one.
  const parts = [header({ name: prefix + '/', prefix: '', mode: 0o755, size: 0, mtime: seconds, type: '5' })];
  for (const entry of tarEntries(dir, { exclude })) {
    const name = `${prefix}/${entry.relative}`;
    const split = entry.relative.endsWith('/') ? { prefix: '', name } : splitName(name);
    // ustar holds 100 bytes of link target; anything longer is written as pax `linkpath`, or the reader gets a
    // truncated link that dangles (a pnpm store link runs past 100 bytes on macOS, #38280).
    const longLink = entry.link !== undefined && Buffer.byteLength(entry.link) > 99;
    const records = [...(split === null ? [paxRecord('path', name)] : []), ...(longLink ? [paxRecord('linkpath', entry.link)] : [])];
    if (records.length > 0) {
      const bytes = Buffer.from(records.join(''), 'utf8');
      parts.push(
        header({ name: `PaxHeaders/${Buffer.byteLength(name)}`, prefix: '', mode: 0o644, size: bytes.length, mtime: seconds, type: 'x' }),
        bytes,
        pad(bytes.length),
        header({ name: split?.name ?? name.slice(0, 100), prefix: split?.prefix ?? '', mode: entry.mode, size: entry.size, mtime: seconds, type: entry.type, link: entry.link }),
      );
    } else {
      parts.push(header({ ...split, mode: entry.mode, size: entry.size, mtime: seconds, type: entry.type, link: entry.link }));
    }
    if (entry.type === '0') {
      const bytes = readFileSync(entry.path);
      parts.push(bytes, pad(bytes.length));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
};

/** Write `<out>` as the gzipped tar of `dir`, and return its sha256 hex. */
export const writeTarGz = ({ dir, prefix, mtime, exclude, out }) => {
  const bytes = gzipSync(writeTar(dir, { prefix, mtime, exclude }), { level: 9 });
  writeFileSync(out, bytes);
  return createHash('sha256').update(bytes).digest('hex');
};
