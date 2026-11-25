import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { listArchive, unpackArchive } from '../src/untar.js';

const top = 'ahpd-0.15.0-beorn.12345678-linux-x64';

interface Tarred {
  readonly name: string;
  readonly kind?: 'file' | 'dir' | 'symlink';
  /** A raw type flag, for the entries a well-behaved build never produces. */
  readonly typeflag?: string;
  readonly body?: string;
  readonly target?: string;
  readonly mode?: number;
}

/**
 * A tar archive built byte by byte: the malicious shapes a real `tar` refuses to create (a `..` name, an absolute
 * name) are exactly the ones this has to refuse on the way in, so they are written here rather than coaxed out of tar.
 */
const archiveOf = (entries: readonly Tarred[]): Buffer => {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const kind = entry.kind ?? 'file';
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    const mode = entry.mode ?? (kind === 'dir' ? 0o755 : 0o644);
    const typeflag = entry.typeflag ?? (kind === 'dir' ? '5' : kind === 'symlink' ? '2' : '0');
    header.write(entry.name, 0, 100, 'utf8');
    header.write(mode.toString(8).padStart(7, '0'), 100, 8, 'utf8');
    header.write('0000000', 108, 8, 'utf8');
    header.write('0000000', 116, 8, 'utf8');
    header.write((kind === 'file' ? body.length : 0).toString(8).padStart(11, '0'), 124, 12, 'utf8');
    header.write('00000000000', 136, 12, 'utf8');
    header.write('        ', 148, 8, 'utf8');
    header.write(typeflag, 156, 1, 'utf8');
    header.write(entry.target ?? '', 157, 100, 'utf8');
    header.write('ustar', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');
    const sum = [...header].reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    blocks.push(header);
    if (kind === 'file' && body.length > 0) {
      blocks.push(body, Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
};

const write = (bytes: Buffer, name = 'archive.tgz'): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-untar-'));
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return file;
};

const into = (): string => join(mkdtempSync(join(tmpdir(), 'ahpd-into-')), 'release');

const gnuTar = (from: string, out: string): void => {
  const tarred = spawnSync('tar', ['--format=gnu', '-czf', out, '-C', from, top], { encoding: 'utf8' });
  if (tarred.status !== 0) throw new Error('tar failed: ' + tarred.stderr);
};

describe('a pinned release archive is checked before it is written (#38280)', () => {
  // @level l3 @consumer the tree a customer runs keeps its exec bits, and only the top directory is dropped.
  it('unpacks one top directory into the release tree, exec bits included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-good-'));
    mkdirSync(join(dir, top, 'bin'), { recursive: true });
    writeFileSync(join(dir, top, 'package.json'), JSON.stringify({ name: 'ahpd' }));
    writeFileSync(join(dir, top, 'bin', 'ahpd'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, top, 'bin', 'ahpd'), 0o755);
    const out = join(dir, 'archive.tgz');
    gnuTar(dir, out);
    const release = into();
    expect(unpackArchive(out, release, top).length).toBeGreaterThan(0);
    expect(existsSync(join(release, 'package.json'))).toBe(true);
    expect(existsSync(join(release, top))).toBe(false);
    expect(statSync(join(release, 'bin', 'ahpd')).mode & 0o111).not.toBe(0);
    expect(readdirSync(release).sort()).toEqual(['bin', 'package.json']);
  });

  // @level l3 @consumer a path and a link target past the 100-byte header field survive: GNU writes them as long
  // name headers, and the install of a real release depends on node-tar reading those rather than truncating.
  it('unpacks a GNU long path and a long symlink target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-long-'));
    const deep = join('a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40));
    mkdirSync(join(dir, top, deep), { recursive: true });
    writeFileSync(join(dir, top, deep, 'deep.txt'), 'deep\n');
    const target = join('a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'deep.txt');
    mkdirSync(join(dir, top, 'links'), { recursive: true });
    symlinkSync(join('..', target), join(dir, top, 'links', 'deep'));
    const out = join(dir, 'archive.tgz');
    gnuTar(dir, out);
    expect([...target].length).toBeGreaterThan(100);
    const release = into();
    unpackArchive(out, release, top);
    expect(readdirSync(join(release, deep)).sort()).toEqual(['deep.txt']);
    expect(readlinkSync(join(release, 'links', 'deep'))).toBe(join('..', target));
    expect(lstatSync(join(release, 'links', 'deep')).isSymbolicLink()).toBe(true);
  });

  // @level l3 @consumer a `..` in any entry refuses the whole archive, and nothing is written before the refusal.
  it('refuses an entry that climbs out with .., before writing anything', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: `${top}/../escaped`, body: 'x' },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/escaped/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer an absolute name is refused too, and the listing still names what it found.
  it('refuses an absolute entry name', () => {
    const archive = write(archiveOf([{ name: `${top}/package.json`, body: '{}' }, { name: '/absolute', body: 'x' }]));
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/absolute/u);
    expect(existsSync(release)).toBe(false);
    expect(listArchive(archive).map((one) => one.name)).toContain('/absolute');
  });

  // @level l3 @consumer a second top-level entry is not a release: it is refused and named.
  it('refuses a second top-level directory', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: 'elsewhere/', kind: 'dir' },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/elsewhere/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer a symlink that points outside the release refuses the archive rather than shipping it.
  it('refuses a symlink that points outside the release', () => {
    for (const target of ['/etc/passwd', '../../../etc/passwd']) {
      const archive = write(
        archiveOf([
          { name: `${top}/package.json`, body: '{}' },
          { name: `${top}/escape`, kind: 'symlink', target },
        ]),
      );
      const release = into();
      expect(() => unpackArchive(archive, release, top)).toThrow(/escape/u);
      expect(existsSync(release)).toBe(false);
    }
  });

  // @level l3 @consumer a hard link is not a link out: one that names a path outside the release is refused.
  it('refuses a hard link that names a path outside the release', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: `${top}/hl`, typeflag: '1', target: '/etc/passwd' },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/hl/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer a symlink's target is relative to the folder the link sits in, so one level up from the
  // top directory points BESIDE the release, not inside it (@cto 2026-11-25).
  it('refuses a symlink that climbs one level out of the release', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: `${top}/link`, kind: 'symlink', target: '../x' },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/link/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer one level up from a folder INSIDE the release is still inside the release: kept.
  it('keeps a symlink in a subfolder that climbs to the release root', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/b`, body: 'b\n' },
        { name: `${top}/a/l`, kind: 'symlink', target: '../b' },
      ]),
    );
    const release = into();
    unpackArchive(archive, release, top);
    expect(readlinkSync(join(release, 'a', 'l'))).toBe('../b');
  });

  // @level l3 @consumer a hard link's target is a path in the archive root, and one that climbs is refused outright.
  it('refuses a hard link that climbs with ..', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: `${top}/hl`, typeflag: '1', target: `${top}/../../etc/passwd` },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/hl/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer a hard link to a file inside the release is how a real tree dedupes, and it stays a link.
  it('keeps a hard link whose target is inside the release', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/x/z`, body: 'z\n' },
        { name: `${top}/x/y`, typeflag: '1', target: `${top}/x/z` },
      ]),
    );
    const release = into();
    unpackArchive(archive, release, top);
    expect(statSync(join(release, 'x', 'y')).ino).toBe(statSync(join(release, 'x', 'z')).ino);
  });

  // @level l3 @consumer the top folder is dropped by strip: 1, so a link that names it again points nowhere real.
  it('refuses a symlink that climbs to the top folder by name and re-enters it', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/b`, body: 'b\n' },
        { name: `${top}/a`, kind: 'symlink', target: `../${top}/b` },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(new RegExp(`${top}/a`, 'u'));
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer an entry node-tar cannot write fails the unpack; a warning would leave a release missing a
  // file while reporting success (a hard link to a path the archive never carries).
  it('fails the unpack when node-tar refuses an entry, instead of leaving a partial release', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/x/z`, body: 'z\n' },
        { name: `${top}/x/y`, typeflag: '1', target: `${top}/missing` },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/ENOENT|link/u);
    expect(existsSync(join(release, 'x', 'y'))).toBe(false);
  });

  // @level l3 @consumer a tree an earlier run left behind is never merged into a release: it is refused by name.
  it('refuses to unpack into a staging tree that already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-good-'));
    mkdirSync(join(dir, top), { recursive: true });
    writeFileSync(join(dir, top, 'package.json'), '{}');
    const out = join(dir, 'archive.tgz');
    gnuTar(dir, out);
    const release = into();
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'left-from-an-earlier-run.js'), 'stale\n');
    expect(() => unpackArchive(out, release, top)).toThrow(/already exists from an earlier run/u);
    // Nothing was written over the leftover: the refusal happens before the first byte.
    expect(readdirSync(release)).toEqual(['left-from-an-earlier-run.js']);
  });

  // @level l3 @consumer a device or fifo is not a file this installer places, and it is named.
  it('refuses a fifo entry', () => {
    const archive = write(
      archiveOf([
        { name: top + '/package.json', body: '{}' },
        { name: top + '/pipe', typeflag: '6' },
      ]),
    );
    const release = into();
    expect(() => unpackArchive(archive, release, top)).toThrow(/fifo/u);
    expect(existsSync(release)).toBe(false);
  });

  // @level l3 @consumer a symlink that stays inside is a normal part of a tree and is kept.
  it('keeps a relative symlink that stays inside the release', () => {
    const archive = write(
      archiveOf([
        { name: `${top}/package.json`, body: '{}' },
        { name: `${top}/bin/ahpd-real`, body: '#!/bin/sh\n', mode: 0o755 },
        { name: `${top}/bin/ahpd`, kind: 'symlink', target: 'ahpd-real' },
      ]),
    );
    const release = into();
    unpackArchive(archive, release, top);
    expect(lstatSync(join(release, 'bin', 'ahpd')).isSymbolicLink()).toBe(true);
  });
});
