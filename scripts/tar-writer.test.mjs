/*
 * The archive writer behind the customer host release (#38280). It exists so a machine with no GNU tar and no gzip
 * binary - a stock Mac - can cut its half; the proof it must pass is that the installer's own reader (node-tar) sees
 * the same archive GNU tar wrote: one top folder, real symlinks, the excluded pnpm shims gone, fixed order and time.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { describe, expect, it } from 'vitest';
import { writeTarGz } from './tar-writer.mjs';

const tree = () => {
  const root = mkdtempSync(join(tmpdir(), 'tar-writer-'));
  const stage = join(root, 'stage');
  mkdirSync(join(stage, 'dist', 'nested'), { recursive: true });
  mkdirSync(join(stage, 'node_modules', '.bin'), { recursive: true });
  mkdirSync(join(stage, 'node_modules', '.pnpm', 'pkg', 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(stage, 'dist', 'nested', 'main.js'), 'console.log(1)\n');
  writeFileSync(join(stage, 'node_modules', '.modules.yaml'), 'state\n');
  writeFileSync(join(stage, 'node_modules', '.bin', 'shim'), '#!/bin/sh\n');
  writeFileSync(join(stage, 'node_modules', '.pnpm', 'pkg', 'node_modules', '.bin', 'shim'), '#!/bin/sh\n');
  symlinkSync('../dist/nested/main.js', join(stage, 'link.js'));
  const long = 'a'.repeat(90) + '/' + 'b'.repeat(90) + '/file.txt';
  mkdirSync(join(stage, 'a'.repeat(90), 'b'.repeat(90)), { recursive: true });
  writeFileSync(join(stage, long), 'long\n');
  return { root, stage };
};

const read = async (file) => {
  const seen = new Map();
  await tar.t({
    file,
    onReadEntry: (entry) => {
      seen.set(entry.path, entry.type === 'SymbolicLink' ? entry.linkpath : entry.type === 'File' ? 'file' : entry.type);
    },
  });
  return seen;
};

describe('the release archive writer', () => {
  it('writes the same bytes twice, under one top folder, with symlinks and exclusions kept', async () => {
    const { root, stage } = tree();
    try {
      const options = { dir: stage, prefix: 'top', mtime: new Date(1_700_000_000 * 1000), exclude: ['node_modules/.bin', '.modules.yaml', '.pnpm-workspace-state-v1.json'] };
      const first = writeTarGz({ ...options, out: join(root, 'a.tar.gz') });
      const second = writeTarGz({ ...options, out: join(root, 'b.tar.gz') });
      expect(second).toBe(first);

      const seen = await read(join(root, 'a.tar.gz'));
      expect([...seen.keys()].every((path) => path === 'top/' || path.startsWith('top/'))).toBe(true);
      expect(seen.has('top/')).toBe(true);
      expect(seen.get('top/link.js')).toBe('../dist/nested/main.js');
      expect(seen.get('top/dist/nested/main.js')).toBe('file');
      expect([...seen.keys()].some((path) => path.includes('/.bin/'))).toBe(false);
      expect([...seen.keys()].some((path) => path.endsWith('.modules.yaml'))).toBe(false);
      expect([...seen.keys()].some((path) => path.includes('a'.repeat(90)))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
