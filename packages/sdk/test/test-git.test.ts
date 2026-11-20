import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { gitSync } from '../../../tools/git.ts';
import setup from '../../../tools/test-tmpdir.ts';

/*
 * A test's own `git`: answered as a string, timed like the host's calls, and
 * stopped at its timeout with the call named.
 */

const before = process.env['AHPD_GIT_SLOW_MS'];

afterEach(() => {
  vi.restoreAllMocks();
  if (before === undefined) delete process.env['AHPD_GIT_SLOW_MS'];
  else process.env['AHPD_GIT_SLOW_MS'] = before;
});

it('answers a call as a string', () => {
  expect(gitSync(['--version'])).toMatch(/^git version /);
});

it('says a call over AHPD_GIT_SLOW_MS on stderr, with its arguments', () => {
  process.env['AHPD_GIT_SLOW_MS'] = '1';
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(2);
  const said: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((line) => { said.push(String(line)); return true; });
  gitSync(['--version']);
  const slow = said.filter((line) => line.startsWith('slow git: '));
  expect(slow).toHaveLength(1);
  expect(slow[0]).toContain('for git --version in -');
});

it('stops a call at its timeout, and names the call', () => {
  // No git starts and answers within a millisecond.
  expect(() => gitSync(['--version'], { timeout: 1 })).toThrow('git --version did not finish in 1 ms');
});

/** A synchronous `git` a test starts itself, with no timeout and no timing. */
const DIRECT = /\b(?:execFileSync|spawnSync)\(\s*['"`]git['"`]/;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

it('finds no test that runs git without gitSync', () => {
  // The pattern is what a test would write, so it is checked on one first,
  // put together here so this file does not match it.
  const call = (name: string, between: string): string => `${name}(${between}'git', ['status'])`;
  expect(DIRECT.test(call('execFileSync', ''))).toBe(true);
  expect(DIRECT.test(call('spawnSync', '\n  '))).toBe(true);
  const direct = readdirSync(join(ROOT, 'packages'))
    .flatMap((pkg) => {
      const tests = join(ROOT, 'packages', pkg, 'test');
      let names: string[];
      try { names = readdirSync(tests, { recursive: true, encoding: 'utf8' }); }
      catch { return []; }
      return names.filter((name) => name.endsWith('.ts')).map((name) => join('packages', pkg, 'test', name));
    })
    .filter((file) => DIRECT.test(readFileSync(join(ROOT, file), 'utf8')));
  expect(direct).toEqual([]);
});

/*
 * A run must fail if a suite writes the checkout's Git bookkeeping. The
 * temporary repository stands in for the checkout; no real checkout is
 * mutated, even when the integrity check is missing.
 */
it.each(['refs', 'HEAD', 'index', 'unchanged'] as const)('checks checkout %s after a test run', (part) => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-checkout-integrity-'));
  const env = { ...process.env };
  const git = (...args: string[]): string => gitSync(['-C', dir, ...args]);
  try {
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'fixture');
    const finish = setup({ config: { root: dir } });
    if (part === 'refs') git('update-ref', 'refs/agents/witness/checkpoints/turn/0', 'HEAD');
    if (part === 'HEAD') git('symbolic-ref', 'HEAD', 'refs/heads/another');
    if (part === 'index') {
      writeFileSync(join(dir, 'staged.txt'), 'fixture\n');
      git('add', 'staged.txt');
    }
    if (part === 'unchanged') expect(finish).not.toThrow();
    else expect(finish).toThrow(/a test changed checkout Git/);
  }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    rmSync(dir, { recursive: true, force: true });
  }
});
