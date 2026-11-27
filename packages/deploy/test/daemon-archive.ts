/**
 * A stand-in daemon archive for the tests that install one: the shape the release really is, a pnpm-deploy bundle of
 * `packages/server`, so the server sits at `dist/main.js` with no `packages/` above it (#38280). One copy, because a
 * fixture that invented its own layout once hid an installer that could not start a release.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const daemonArchive = (source: string): Buffer => {
  const top = source.split('/').pop()!.replace(/\.tar\.gz$/u, '');
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-archive-'));
  mkdirSync(join(dir, top, 'dist'), { recursive: true });
  writeFileSync(join(dir, top, 'package.json'), JSON.stringify({ name: 'ahpd-server' }));
  writeFileSync(join(dir, top, 'dist', 'main.js'), 'export const started = true\n');
  const out = join(dir, 'archive.tgz');
  const tarred = spawnSync('tar', ['-czf', out, '-C', dir, top], { encoding: 'utf8' });
  if (tarred.status !== 0) throw new Error(`tar failed: ${tarred.stderr}`);
  return readFileSync(out);
};
