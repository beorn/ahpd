import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  currentRelease,
  DEFAULT_KEEP,
  deploy,
  lastSwitchFrom,
  pruneReleases,
  readJournal,
  resolveVersion,
  status,
  sweep,
  writeJournalEntry,
  type DeployDeclaration,
} from '../src/index.js';
import { gitSync } from '../../../tools/git.ts';

const FIXTURE_IDENTITY = {
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

/** Every git call in this suite goes through gitSync, the repo's timed wrapper (#ahpd test rule). */
const git = (cwd: string, ...args: string[]): string =>
  gitSync(args, { cwd, env: { ...process.env, ...FIXTURE_IDENTITY } }).trim();

/** A commit stamped at a fixed time, so release order is a fact of the fixture and not of the wall clock. */
const gitAt = (cwd: string, at: string, ...args: string[]): string =>
  gitSync(args, { cwd, env: { ...process.env, ...FIXTURE_IDENTITY, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).trim();

/** A repo with `main` at one commit and `side` at another, so reachability is a real question. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-deploy-'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'file.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'one');
  const main = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '--quiet', '-c', 'side');
  writeFileSync(join(repo, 'file.txt'), 'two\n');
  git(repo, 'commit', '--quiet', '-am', 'two');
  const side = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'switch', '--quiet', 'main');
  return { root, repo, main, side, stateDir: join(root, 'state') };
};

const declaration = (repo: string, extra: Partial<DeployDeclaration> = {}): DeployDeclaration => ({
  repo,
  ref: 'main',
  check: { command: 'true' },
  ...extra,
});

describe('deploy driver (#38276)', () => {
  it('resolves a version once to a sha and refuses one the declared ref cannot reach', async () => {
    const { repo, main, side, stateDir } = fixture();
    const layout = { stateDir, service: 'svc' };
    expect(resolveVersion(layout, { repo, ref: 'main' }, 'main')).toBe(main);
    expect(() => resolveVersion(layout, { repo, ref: 'main' }, side)).toThrow(/not reachable from main/u);
    expect(() => resolveVersion(layout, { repo, ref: 'main' }, 'nope')).toThrow(/not a commit/u);
  });

  it('writes started <from>-><to> before any step, then switches one symlink and checks', async () => {
    const { repo, main, stateDir } = fixture();
    const result = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    expect(result.outcome.state).toBe('switched, checked');
    expect(result.sha).toBe(main);
    expect(currentRelease({ stateDir, service: 'svc' })).toBe(main);
    const journal = readJournal({ stateDir, service: 'svc' });
    expect(journal[0]).toMatchObject({ event: 'started', from: null, to: main });
    expect(journal.map((one) => one.event)).toContain('switched');
  });

  it('says switched, unchecked when the declaration has no check, and never healthy', async () => {
    const { repo, stateDir } = fixture();
    const result = await deploy({ stateDir, service: 'svc', version: 'main', declaration: { repo, ref: 'main' } });
    expect(result.outcome.state).toBe('switched, unchecked');
  });

  // @level l3 @consumer a pruned release that leaves no journal line is a gap the next reader cannot see.
  it('names the release a prune removed, so a vanished folder is never silent', async () => {
    const { repo, stateDir } = fixture();
    const layout = { stateDir, service: 'svc' };
    const shas: string[] = [];
    for (const name of ['two', 'three', 'four']) {
      writeFileSync(join(repo, 'file.txt'), `${name}\n`);
      git(repo, 'commit', '--quiet', '-am', name);
      shas.push(git(repo, 'rev-parse', 'HEAD'));
    }
    for (const sha of shas) {
      expect((await deploy({ stateDir, service: 'svc', version: sha, declaration: declaration(repo, { keep: 2 }) })).outcome.state)
        .toBe('switched, checked');
    }
    // Current is the third release and the way back is the second, so keep 2 leaves the first one out.
    const journal = readJournal(layout);
    const pruned = journal.filter((one) => one.event === 'pruned');
    expect(pruned).toHaveLength(1);
    const [oldest = '', wayBack = ''] = shas;
    expect(pruned[0]).toMatchObject({ keep: 2, releases: [oldest] });
    expect(existsSync(join(stateDir, 'deploy', 'svc', 'releases', oldest))).toBe(false);
    expect(existsSync(join(stateDir, 'deploy', 'svc', 'releases', wayBack))).toBe(true);
  });

  it('keeps the new release live and fails loudly when a check fails without a declared migration', async () => {
    const { repo, stateDir } = fixture();
    const first = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    expect(first.outcome.state).toBe('switched, checked');
    const failing = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: declaration(repo, { check: { command: 'false' } }),
    });
    expect(failing.outcome.state).toBe('failed, new release live');
    expect(currentRelease({ stateDir, service: 'svc' })).toBe(first.sha);
  });

  it('switches back only for migrations: expand-only, and says the migration stays applied', async () => {
    const { repo, side, stateDir } = fixture();
    const first = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    const moving = await deploy({
      stateDir,
      service: 'svc',
      version: 'side',
      declaration: declaration(repo, { migrations: 'expand-only', check: { command: 'false' } }),
    });
    expect(moving.outcome.state).toBe('switched back, migration stays applied');
    expect(moving.sha).toBe(side);
    expect(currentRelease({ stateDir, service: 'svc' })).toBe(first.sha);
    const journal = readJournal({ stateDir, service: 'svc' });
    expect(journal.some((one) => one.event === 'switched back')).toBe(true);
  });

  it('refuses a build the machine does not accept, before anything is switched, and says why', async () => {
    const { repo, stateDir } = fixture();
    const result = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: declaration(repo, { build: { command: 'true' }, check: { command: 'true' } }),
      permit: (step, command) => step === 'build' && command.command === 'true'
        ? 'this machine does not accept commands from Hightea; set allowRemoteCommands locally'
        : undefined,
    });
    expect(result.outcome).toMatchObject({ state: 'refused, command not allowed', step: 'build' });
    expect(currentRelease({ stateDir, service: 'svc' })).toBeNull();
    const journal = readJournal({ stateDir, service: 'svc' });
    expect(journal.some((one) => one.event === 'refused' && one['step'] === 'build')).toBe(true);
    expect(journal.some((one) => one.event === 'switched')).toBe(false);
  });

  it('refuses the whole deploy up front when any declared command is refused, so a switch never happens unchecked', async () => {
    const { repo, stateDir } = fixture();
    const result = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: declaration(repo),
      permit: () => 'commands from Hightea are off on this machine',
    });
    expect(result.outcome).toMatchObject({ state: 'refused, command not allowed', step: 'check', reason: 'commands from Hightea are off on this machine' });
    expect(currentRelease({ stateDir, service: 'svc' })).toBeNull();
    const journal = readJournal({ stateDir, service: 'svc' });
    expect(journal.some((one) => one.event === 'started')).toBe(false);
    expect(journal.some((one) => one.event === 'switched')).toBe(false);
  });

  it('gives a step only PATH, HOME, LANG, TMPDIR and its own references, never the daemon\'s environment', async () => {
    const { repo, stateDir } = fixture();
    process.env['DEPLOY_TEST_TOKEN'] = 'ahpd-holds-this';
    try {
      const result = await deploy({
        stateDir,
        service: 'svc',
        version: 'main',
        declaration: declaration(repo, {
          check: { command: 'sh', args: ['-c', 'echo inherited=$DEPLOY_TEST_TOKEN; echo path=$PATH'] },
        }),
      });
      expect(result.outcome.state).toBe('switched, checked');
      const said = result.steps.find((one) => one.step === 'check')?.output ?? '';
      expect(said.split('\n')[0]).toBe('inherited=');
      expect(said).not.toContain('ahpd-holds-this');
      expect(said.split('\n')[1]).not.toBe('path=');
    } finally {
      delete process.env['DEPLOY_TEST_TOKEN'];
    }
  });

  it('reads a declared $secret from the machine\'s vault and starts nothing when the vault has no value', async () => {
    const { repo, stateDir } = fixture();
    const withSecret = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: declaration(repo, {
        check: { command: 'sh', args: ['-c', 'echo token=$TOKEN'], env: { TOKEN: { $secret: 'env:DEPLOY_VAULT' } } },
      }),
      secrets: (ref) => (ref === 'env:DEPLOY_VAULT' ? 'from-the-vault' : undefined),
    });
    expect(withSecret.outcome.state).toBe('switched, checked');
    expect(withSecret.steps.find((one) => one.step === 'check')?.output).toContain('token=from-the-vault');

    const missing = join(stateDir, 'must-not-exist');
    const without = await deploy({
      stateDir,
      service: 'other',
      version: 'main',
      declaration: { repo, ref: 'main', build: { command: 'sh', args: ['-c', 'touch ' + missing], env: { TOKEN: { $secret: 'env:ABSENT' } } } },
      secrets: () => undefined,
      machine: 'the-test-machine',
    });
    expect(without.outcome).toMatchObject({ state: 'failed, new release live', step: 'build' });
    expect(String((without.outcome as { reason?: string }).reason)).toContain('secret env:ABSENT has no value on the-test-machine');
    expect(without.steps.find((one) => one.step === 'build')).toMatchObject({ ok: false, code: 78 });
    expect(existsSync(missing)).toBe(false);
  });

  it('kills a step that outlives its timeout and says "timed out after N" rather than an exit code', async () => {
    const { repo, stateDir } = fixture();
    const result = await deploy({
      stateDir,
      service: 'svc',
      version: 'main',
      declaration: { repo, ref: 'main', build: { command: 'sh', args: ['-c', 'sleep 30'], timeoutMs: 250 } },
    });
    expect(result.outcome.state).toBe('failed, new release live');
    expect(String((result.outcome as { reason?: string }).reason)).toContain('timed out after 250');
    expect(result.steps.find((one) => one.step === 'build')).toMatchObject({ ok: false, timedOut: true });
  }, 20_000);

  it('treats a lock whose pid now belongs to another process as dead, and never resumes it', async () => {
    const { repo, main, stateDir } = fixture();
    const root = join(stateDir, 'deploy', 'svc');
    mkdirSync(root, { recursive: true });
    // This pid is alive (it is this process), but the start time recorded beside it is not the one it has.
    writeFileSync(join(root, 'deploy.lock'),
      JSON.stringify({ deployId: 'reused', step: 'build', pid: process.pid, pidStart: '1', startedAt: new Date().toISOString(), from: null, to: main }) + '\n');
    const answer = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    expect(answer.outcome).toMatchObject({ state: 'outcome unknown', step: 'build', deployId: 'reused' });
    expect(status({ stateDir, service: 'svc' }).lock).toBeUndefined();
  });

  it('refuses keep below 2 by name, so there is always a folder to switch back to', async () => {
    const { repo, stateDir } = fixture();
    const answer = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo, { keep: 1 }) });
    expect(answer.outcome).toMatchObject({ state: 'refused, invalid declaration' });
    expect(String((answer.outcome as { reason?: string }).reason)).toContain('at least 2');
    expect(currentRelease({ stateDir, service: 'svc' })).toBeNull();
  });

  it('sweeps what an earlier process left unfinished at start, and leaves a live deploy alone', async () => {
    const { repo, main, stateDir } = fixture();
    mkdirSync(join(stateDir, 'deploy', 'dead'), { recursive: true });
    writeFileSync(join(stateDir, 'deploy', 'dead', 'deploy.lock'),
      `${JSON.stringify({ deployId: 'died', step: 'switch', pid: 999_999, startedAt: new Date().toISOString(), from: null, to: main })}\n`);
    mkdirSync(join(stateDir, 'deploy', 'busy'), { recursive: true });
    writeFileSync(join(stateDir, 'deploy', 'busy', 'deploy.lock'),
      `${JSON.stringify({ deployId: 'live', step: 'check', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: main })}\n`);
    await deploy({ stateDir, service: 'quiet', version: 'main', declaration: declaration(repo) });
    expect(sweep(stateDir)).toEqual([{ service: 'dead', step: 'switch', deployId: 'died' }]);
    expect(status({ stateDir, service: 'dead' }).lock).toBeUndefined();
    expect(readJournal({ stateDir, service: 'dead' }).some((one) => one.event === 'outcome unknown')).toBe(true);
    expect(status({ stateDir, service: 'busy' }).lock?.deployId).toBe('live');
  });

  it('refuses a second deploy by name with the running deploy id, and reports an unfinished one as outcome unknown', async () => {
    const { repo, main, stateDir } = fixture();
    const layout = { stateDir, service: 'svc' };
    // A live holder: this process is alive, so the lock is genuinely in use.
    mkdirSync(join(stateDir, 'deploy', 'svc'), { recursive: true });
    writeFileSync(join(stateDir, 'deploy', 'svc', 'deploy.lock'),
      `${JSON.stringify({ deployId: 'running-one', step: 'check', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: main })}\n`);
    const refused = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    expect(refused.outcome).toMatchObject({ state: 'refused, deploy running', deployId: 'running-one' });
    expect(status(layout).lock?.deployId).toBe('running-one');

    // A holder whose process is gone: never resumed, reported with the step it died in.
    writeFileSync(join(stateDir, 'deploy', 'svc', 'deploy.lock'),
      `${JSON.stringify({ deployId: 'died', step: 'before_switch', pid: 999_999, startedAt: new Date().toISOString(), from: null, to: main })}\n`);
    const unknown = await deploy({ stateDir, service: 'svc', version: 'main', declaration: declaration(repo) });
    expect(unknown.outcome).toMatchObject({ state: 'outcome unknown', step: 'before_switch', deployId: 'died' });
    expect(readJournal(layout).some((one) => one.event === 'outcome unknown')).toBe(true);
  });

  it('keeps the current release plus the default number, and prunes the rest by name', async () => {
    const { root, repo, stateDir } = fixture();
    const releases = join(stateDir, 'deploy', 'svc', 'releases');
    mkdirSync(releases, { recursive: true });
    const store = join(stateDir, 'deploy', 'svc', 'objects', 'repo.git');
    git(root, 'clone', '--quiet', '--bare', repo, store);
    // Five releases over five distinct commit times, oldest first, so "newest" is a real answer and not a tie.
    const names = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'];
    names.forEach((name, index) => {
      writeFileSync(join(repo, 'release.txt'), `${name}\n`);
      git(repo, 'add', '.');
      gitAt(repo, `2026-01-0${String(index + 1)}T00:00:00+0000`, 'commit', '--quiet', '-m', `release ${name}`);
      const sha = git(repo, 'rev-parse', 'HEAD');
      git(root, '-C', store, 'fetch', '--quiet', repo, '+refs/heads/*:refs/remotes/origin/*');
      git(root, '-C', store, 'worktree', 'add', '--detach', join(releases, name), sha);
    });
    symlinkSync(join('releases', 'eeee'), join(stateDir, 'deploy', 'svc', 'current'), 'dir');
    expect(DEFAULT_KEEP).toBe(3);
    const removed = pruneReleases({ stateDir, service: 'svc' }, DEFAULT_KEEP);
    expect([...removed].sort()).toEqual(['aaaa', 'bbbb']);
    expect(realpathSync(join(stateDir, 'deploy', 'svc', 'current'))).toContain('eeee');
    expect(readFileSync(join(releases, 'eeee', 'release.txt'), 'utf8')).toBe('eeee\n');
    expect(existsSync(join(releases, 'aaaa'))).toBe(false);
  });

  // @level l3 @consumer the journal is how a prune knows the way back: the release the last switch left is kept.
  it('keeps the release the last switch left, and names it from the journal', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ahpd-switch-from-'));
    const layout = { stateDir, service: 'svc' };
    expect(lastSwitchFrom(layout)).toBe(null);
    writeJournalEntry(layout, { event: 'deploy', deployId: 'x' });
    expect(lastSwitchFrom(layout)).toBe(null);
    writeJournalEntry(layout, { event: 'switched', to: 'bbbb', from: 'aaaa', reason: 'deploy' });
    expect(lastSwitchFrom(layout)).toBe('aaaa');
    // A line that leaves nothing behind is a first install, not a target to invent.
    writeJournalEntry(layout, { event: 'switched', to: 'cccc', from: null, reason: 'deploy' });
    expect(lastSwitchFrom(layout)).toBe(null);
  });

  // @level l3 @consumer a switch back is not a way back: after a failed upgrade the good release stays the target.
  it('ignores a switch-back line, so the bad release never becomes the way back', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ahpd-way-back-'));
    const layout = { stateDir, service: 'svc' };
    // A is running; the upgrade to B fails and the host switches back to A; then a later good upgrade lands on C.
    writeJournalEntry(layout, { event: 'switched', to: 'aaaa', from: null, reason: 'deploy' });
    writeJournalEntry(layout, { event: 'switched', to: 'bbbb', from: 'aaaa', reason: 'deploy' });
    writeJournalEntry(layout, { event: 'switched', to: 'aaaa', from: 'bbbb', reason: 'switching back after a failed start' });
    // The host is on A now, and the way back is the release the forward switch left - the original one, not B.
    expect(lastSwitchFrom(layout)).toBe('aaaa');
    writeJournalEntry(layout, { event: 'switched', to: 'cccc', from: 'aaaa', reason: 'deploy' });
    expect(lastSwitchFrom(layout)).toBe('aaaa');
  });

  // @level l3 @consumer the flag is the contract: rewording the reason cannot turn a switch back into a way back.
  it('skips a switch back by its flag even when the reason says something else', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'ahpd-way-back-flag-'));
    const layout = { stateDir, service: 'svc' };
    writeJournalEntry(layout, { event: 'switched', to: 'aaaa', from: null, reason: 'deploy' });
    writeJournalEntry(layout, { event: 'switched', to: 'bbbb', from: 'aaaa', reason: 'deploy' });
    writeJournalEntry(layout, { event: 'switched', to: 'aaaa', from: 'bbbb', reason: 'back to the release that worked', back: true });
    expect(lastSwitchFrom(layout)).toBe('aaaa');
    writeJournalEntry(layout, { event: 'switched', to: 'cccc', from: 'aaaa', reason: 'deploy' });
    expect(lastSwitchFrom(layout)).toBe('aaaa');
  });
});
