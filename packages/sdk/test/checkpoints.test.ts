import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASELINE_TURN } from '../src/types/changes.js';
import { baselineOf, captureBaseline, captureTurn, latestOf, removeAll } from '../src/sessions/checkpoints.js';
import { gitChanges } from '../src/sessions/changes.js';
import { uriOf } from '../src/resources/fileuri.js';
import { gitSync } from '../../../tools/git.ts';

/*
 * What a turn leaves behind in the folder it ran in.
 *
 * A checkpoint is the whole of "what did this session change": git can say
 * what a working tree looks like now and nothing about which of two sessions
 * in one folder made it look that way. What is checked here is that the
 * commits are written where a client never sees them and that the person's
 * own branch, index and working tree are not touched on the way.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** Git's own answer, which is what the assertions are about. */
const gitIn = (dir: string, ...args: string[]): string =>
  gitSync(['-C', dir, ...args]);

const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-checkpoint-'));
  made.push(dir);
  const run = (...args: string[]): void => { gitSync(['-C', dir, ...args]); };
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  return dir;
};

/** Every ref one session left in a folder, as git names them. */
const refsOf = (dir: string, session: string): string[] =>
  gitIn(dir, 'for-each-ref', '--format=%(refname)', `refs/agents/${session}/checkpoints/`)
    .split('\n')
    .filter((line) => line !== '')
    .sort();

/** The files in the tree one checkpoint holds. */
const filesIn = (dir: string, at: string): string[] =>
  gitIn(dir, 'ls-tree', '-r', '--name-only', at).split('\n').filter((line) => line !== '');

describe('what a session leaves in its folder', () => {
  it('writes one commit per turn and moves nothing of the person\'s', async () => {
    const dir = repository();
    const head = gitIn(dir, 'rev-parse', 'HEAD');
    const index = gitIn(dir, 'ls-files', '--stage');

    await captureBaseline(dir, 's1');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await captureTurn(dir, 's1', '1');
    writeFileSync(join(dir, 'second.txt'), 'new\n');
    await captureTurn(dir, 's1', '2');

    expect(refsOf(dir, 's1')).toEqual([
      'refs/agents/s1/checkpoints/turn/0',
      'refs/agents/s1/checkpoints/turn/1',
      'refs/agents/s1/checkpoints/turn/2',
    ]);
    // The person's own, as they were: the commits are made with `commit-tree`
    // and the refs are under `refs/agents/`, so neither HEAD nor the branch
    // has anywhere to move to.
    expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(gitIn(dir, 'ls-files', '--stage')).toBe(index);
    /*
     * And the index it staged into is not the one a commit would take. ` M`
     * and `??` are changes the working tree has and the index does not; a
     * staged one would read `M ` and be in the index above.
     */
    expect(gitIn(dir, 'status', '--porcelain')).toBe(' M tracked.txt\n?? second.txt\n');
  });

  it('writes a checkpoint where git has no identity configured', async () => {
    const dir = repository();
    const run = (...args: string[]): void => { gitSync(['-C', dir, ...args]); };
    run('config', '--unset', 'user.email');
    run('config', '--unset', 'user.name');
    // Git would otherwise make one up from the machine's name.
    run('config', 'user.useConfigOnly', 'true');
    const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      await captureBaseline(dir, 's1');
      expect(await baselineOf(dir, 's1')).toBeDefined();
    }
    finally {
      if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved.global;
      if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = saved.system;
    }
  });

  it('counts a file a shell command wrote as part of the turn', async () => {
    const dir = repository();
    await captureBaseline(dir, 's1');
    // What a terminal tool of the agent does, and what the edit tracker of a
    // session never sees: a file written behind its back, on any system.
    writeFileSync(join(dir, 'shell.txt'), 'from a shell\n');
    await captureTurn(dir, 's1', '1');

    const at = await latestOf(dir, 's1');
    expect(at).toBeDefined();
    expect(filesIn(dir, at as string)).toContain('shell.txt');
  });

  it('keeps the first baseline it wrote, and answers it as the newest until a turn runs', async () => {
    const dir = repository();
    await captureBaseline(dir, 's1');
    const first = await baselineOf(dir, 's1');
    expect(first).toBeDefined();
    expect(await latestOf(dir, 's1')).toBe(first);

    writeFileSync(join(dir, 'later.txt'), 'x\n');
    await captureBaseline(dir, 's1');
    expect(await baselineOf(dir, 's1')).toBe(first);
    expect(refsOf(dir, 's1')).toEqual([`refs/agents/s1/checkpoints/turn/${BASELINE_TURN}`]);
  });

  it('takes a session\'s refs with it, and only its own', async () => {
    const dir = repository();
    await captureBaseline(dir, 's1');
    await captureTurn(dir, 's1', '1');
    await captureBaseline(dir, 's2');
    await captureTurn(dir, 's2', '1');

    await removeAll(dir, 's1');

    expect(refsOf(dir, 's1')).toEqual([]);
    expect(refsOf(dir, 's2')).toEqual([
      'refs/agents/s2/checkpoints/turn/0',
      'refs/agents/s2/checkpoints/turn/1',
    ]);
  });

  it('says nothing at all in a folder that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'ahpd-plain-'));
    made.push(plain);

    await expect(captureBaseline(plain, 's1')).resolves.toBeUndefined();
    await expect(captureTurn(plain, 's1', '1')).resolves.toBeUndefined();
    await expect(removeAll(plain, 's1')).resolves.toBeUndefined();
    expect(await baselineOf(plain, 's1')).toBeUndefined();
    expect(await latestOf(plain, 's1')).toBeUndefined();
  });
});

/*
 * What a session's own changes are.
 *
 * The counts a row carries belong to the session and not to the folder: a
 * commit in the folder takes the folder's to nothing, and two sessions in one
 * folder have the same folder. Session Changes is the difference between the
 * session's baseline checkpoint and the last turn it finished, which git can
 * answer once both ends are commits - and the edit tracker answers where it
 * cannot, which is a folder that is not a repository.
 */
describe('what a session changed', () => {
  it('gives two sessions in one folder their own changes', async () => {
    const dir = repository();
    const source = gitChanges();
    await captureBaseline(dir, 's1');
    writeFileSync(join(dir, 'one.txt'), 'from s1\n');
    await captureTurn(dir, 's1', '1');
    // The second session starts on the tree the first one left, which is what
    // makes what it did next its own.
    await captureBaseline(dir, 's2');
    writeFileSync(join(dir, 'two.txt'), 'from s2\n');
    await captureTurn(dir, 's2', '1');

    const mine = await source.state(dir, 's1', 'session');
    const theirs = await source.state(dir, 's2', 'session');

    expect(mine?.files.map((one) => one.id)).toEqual([uriOf(join(dir, 'one.txt'))]);
    expect(theirs?.files.map((one) => one.id)).toEqual([uriOf(join(dir, 'two.txt'))]);
    // A file the session created is read from the checkpoint that has it, as
    // a creation: no `before` side, and every line of it an addition.
    const after = mine?.files[0]?.edit.after?.content.uri;
    expect(await source.read?.(after as string)).toMatchObject({ data: 'from s1\n' });
    expect(await source.sessionSummary?.(dir, 's1')).toEqual({ files: 1, additions: 1, deletions: 0 });
  });

  it('is not moved by a commit in the folder', async () => {
    const dir = repository();
    const source = gitChanges();
    await captureBaseline(dir, 's1');
    writeFileSync(join(dir, 'made.txt'), 'by the session\n');
    await captureTurn(dir, 's1', '1');
    const before = await source.sessionSummary?.(dir, 's1');

    gitSync(['-C', dir, 'add', '-A']);
    gitSync(['-C', dir, 'commit', '-q', '-m', 'the work']);

    expect(await source.sessionSummary?.(dir, 's1')).toEqual(before);
    expect((await source.state(dir, 's1', 'session'))?.files).toHaveLength(1);
  });

  it('leaves an edit made by hand after the last turn out of the counts', async () => {
    const dir = repository();
    const source = gitChanges();
    await captureBaseline(dir, 's1');
    writeFileSync(join(dir, 'made.txt'), 'by the session\n');
    await captureTurn(dir, 's1', '1');
    // Typing in the file afterwards is not the session's work, and the
    // checkpoints are what say so.
    writeFileSync(join(dir, 'made.txt'), 'by the session\nand by hand\n');

    expect(await source.sessionSummary?.(dir, 's1')).toEqual({ files: 1, additions: 1, deletions: 0 });
    expect((await source.state(dir, 's1', 'session'))?.files[0]?.edit.diff).toEqual({ added: 1, removed: 0 });
  });

  it('answers with the edit tracker in a folder that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'ahpd-plain-'));
    made.push(plain);
    const source = gitChanges();
    const file = join(plain, 'note.txt');
    writeFileSync(file, 'one\ntwo\n');
    await source.observe?.(plain, 's1', '1', file, 'before', '');
    await source.observe?.(plain, 's1', '1', file, 'after', 'one\ntwo\n');

    expect(await source.sessionSummary?.(plain, 's1')).toEqual({ files: 1, additions: 2, deletions: 0 });
    expect((await source.state(plain, 's1', 'session'))?.files).toHaveLength(1);
    // And a row of a session with nothing in it is no counts at all.
    expect(await source.sessionSummary?.(plain, 's2')).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it('exposes no per-turn checkpoint capture while keeping removeCheckpoints and answering changes from the tool tracker in a git repository', async () => {
    const dir = repository();
    const source = gitChanges();
    expect(source.checkpoint).toBeUndefined();
    expect(source.removeCheckpoints).toBeTypeOf('function');

    const file = join(dir, 'tracked.txt');
    await source.observe?.(dir, 's1', '1', file, 'before', 'one\n');
    writeFileSync(file, 'one\ntwo\n');
    await source.observe?.(dir, 's1', '1', file, 'after', 'one\ntwo\n');

    expect(refsOf(dir, 's1')).toEqual([]);
    expect(await source.sessionSummary?.(dir, 's1')).toEqual({ files: 1, additions: 1, deletions: 0 });
    expect((await source.state(dir, 's1', 'session'))?.files.map((one) => one.id)).toEqual([uriOf(file)]);
  });

  it('offers the scope under VS Code\'s own name', async () => {
    const dir = repository();
    const source = gitChanges();
    await source.observe?.(dir, 's1', '1', join(dir, 'tracked.txt'), 'after', 'one\n');

    expect(source.scopes(dir, 's1').find((one) => one.id === 'session'))
      .toMatchObject({ label: 'Session Changes', description: 'Show all changes made in this session', changeKind: 'session' });
  });
});
