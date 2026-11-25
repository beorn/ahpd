import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { pushRemoteOf } from '../src/sessions/changes.js';
import { gitSync } from '../../../tools/git.ts';

/*
 * The remote Create PR pushes a branch with no upstream to, in VS Code's
 * order: the branch's configured push remote, the GitHub remote with `origin`
 * first, `origin`, then the only remote.
 * https://github.com/microsoft/vscode/commit/1808c5c2a55e
 */
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const repo = (remotes: Record<string, string>, config: Record<string, string> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-push-remote-'));
  made.push(dir);
  const git = (...args: string[]): void => { gitSync(args, { cwd: dir }); };
  git('init', '-q');
  for (const [name, url] of Object.entries(remotes)) git('remote', 'add', name, url);
  for (const [key, value] of Object.entries(config)) git('config', key, value);
  return dir;
};

it('pushes to the GitHub remote when the repository has no origin', async () => {
  const dir = repo({ upstream: 'https://github.com/example/project.git' });
  expect((await pushRemoteOf(dir, 'topic')).name).toBe('upstream');
});

it('takes origin first among GitHub remotes, and a GitHub remote over a non-GitHub origin', async () => {
  expect((await pushRemoteOf(repo({ fork: 'git@github.com:someone/project.git', origin: 'https://github.com/example/project' }), 'topic')).name).toBe('origin');
  expect((await pushRemoteOf(repo({ origin: 'https://git.example.com/project.git', upstream: 'https://github.com/example/project' }), 'topic')).name).toBe('upstream');
});

it('takes the branch\'s configured push remote over everything else', async () => {
  const dir = repo({ origin: 'https://github.com/example/project', mine: 'https://github.com/someone/project' }, { 'branch.topic.pushRemote': 'mine' });
  expect(await pushRemoteOf(dir, 'topic')).toEqual({ name: 'mine', url: 'https://github.com/someone/project' });
  const fallback = repo({ origin: 'https://github.com/example/project', mine: 'https://github.com/someone/project' }, { 'remote.pushDefault': 'mine' });
  expect((await pushRemoteOf(fallback, 'topic')).name).toBe('mine');
});

it('takes origin, then the only remote, when no remote is a GitHub one', async () => {
  expect((await pushRemoteOf(repo({ origin: 'https://git.example.com/a.git', other: 'https://git.example.com/b.git' }), 'topic')).name).toBe('origin');
  expect((await pushRemoteOf(repo({ elsewhere: 'https://git.example.com/a.git' }), 'topic')).name).toBe('elsewhere');
});
