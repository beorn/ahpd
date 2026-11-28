import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type * as fsTypes from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gitSync } from '../../../tools/git.ts';

/**
 * #39160: the plugin polls the lock every 25 ms while its child takes it and moves it through the steps. A reader that
 * finds the lock empty or half-written calls the holder 'unreadable', and the plugin then refuses its own deploy as
 * RUNNING while the child goes on and finishes (live 2026-11-27 20:01 PST, terminfo-site edd47fdc). So the lock must
 * only ever be seen whole. This wraps node:fs so every write that touches deploy.lock is read back the way a reader on
 * another process could see it at that moment: an in-place write is a truncate and then a write (what O_TRUNC does),
 * and a 'wx' create is an empty file until the body lands.
 */
const seen: { readonly via: string; readonly text: string }[] = [];

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const isLock = (path: unknown): path is string => typeof path === 'string' && path.endsWith('deploy.lock');
  const lockFds = new Map<number, string>();
  const observe = (via: string, path: string): void => {
    if (!real.existsSync(path)) return;
    const text = real.readFileSync(path, 'utf8');
    try {
      JSON.parse(text);
    } catch {
      seen.push({ via, text });
    }
  };
  const openSync = ((path: fsTypes.PathLike, flags?: fsTypes.OpenMode, mode?: fsTypes.Mode) => {
    const fd = real.openSync(path, flags ?? 'r', mode);
    if (isLock(path)) {
      lockFds.set(fd, path);
      observe(`openSync ${String(flags)}`, path);
    }
    return fd;
  }) as typeof real.openSync;
  const writeSync = ((fd: number, ...rest: unknown[]) => {
    const path = lockFds.get(fd);
    if (path !== undefined) observe('writeSync (before the body)', path);
    return (real.writeSync as (...args: unknown[]) => number)(fd, ...rest);
  }) as typeof real.writeSync;
  const closeSync = ((fd: number) => {
    lockFds.delete(fd);
    return real.closeSync(fd);
  }) as typeof real.closeSync;
  const writeFileSync = ((path: fsTypes.PathOrFileDescriptor, data: unknown, options?: fsTypes.WriteFileOptions) => {
    if (isLock(path) && real.existsSync(path)) {
      real.truncateSync(path, 0);
      observe('writeFileSync (truncated, before the body)', path);
    }
    return real.writeFileSync(path, data as string, options);
  }) as typeof real.writeFileSync;
  const renameSync = ((from: fsTypes.PathLike, to: fsTypes.PathLike) => {
    real.renameSync(from, to);
    if (isLock(to)) observe('renameSync (after)', to);
  }) as typeof real.renameSync;
  const linkSync = ((from: fsTypes.PathLike, to: fsTypes.PathLike) => {
    real.linkSync(from, to);
    if (isLock(to)) observe('linkSync (after)', to);
  }) as typeof real.linkSync;
  const wrapped = { ...real, openSync, writeSync, closeSync, writeFileSync, renameSync, linkSync };
  return { ...wrapped, default: wrapped };
});

const { deploy, status } = await import('../src/index.js');

const git = (cwd: string, ...args: string[]): string =>
  gitSync(args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  }).trim();

describe('deploy lock is only ever seen whole (#39160)', () => {
  it('never shows a reader an empty or half-written lock while it is taken or moved through the steps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-deploy-lock-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '--quiet', '--initial-branch=main');
    writeFileSync(join(repo, 'file.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'one');
    const stateDir = join(root, 'state');

    seen.length = 0;
    const result = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: { repo, ref: 'main', build: { command: 'true' }, check: { command: 'true' } },
    });

    expect(result.outcome.state).toBe('switched, checked');
    expect(seen).toEqual([]);
    expect(status({ stateDir, service: 'svc' }).lock).toBeUndefined();
  });

  it('still lets exactly one of two takers win, and the loser names the winner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-deploy-lock-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '--quiet', '--initial-branch=main');
    writeFileSync(join(repo, 'file.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'one');
    const stateDir = join(root, 'state');
    mkdirSync(join(stateDir, 'deploy', 'svc'), { recursive: true });
    // A live holder (this process) already has the lock.
    writeFileSync(
      join(stateDir, 'deploy', 'svc', 'deploy.lock'),
      `${JSON.stringify({ deployId: 'first', step: 'build', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: 'x' })}\n`,
    );
    seen.length = 0;
    const second = await deploy({ stateDir, service: 'svc', version: 'main', declaration: { repo, ref: 'main' } });
    expect(second.outcome.state).not.toBe('switched, checked');
    expect(JSON.stringify(second)).toContain('first');
    expect(status({ stateDir, service: 'svc' }).lock?.deployId).toBe('first');
  });
});
