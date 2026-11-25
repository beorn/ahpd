import { describe, expect, it } from 'vitest';
import { createWorktreeRemovalQueue, memoryWorktreeRemovals } from '../src/host/worktreeremovals.js';
import type { RemovalOutcome, WorktreeRemoval } from '../src/host/worktreeremovals.js';

/*
 * The worktree removals still to make, as VS Code's queue keeps them: a record
 * a pass works through, kept with its status and tried again after a wait.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L719-L805
 */

/** A queue on a stood-in clock, whose processing answers what the case hands it. */
const queue = (answers: RemovalOutcome[]) => {
  let now = 1_000;
  const seen: { path: string; force: boolean }[] = [];
  const store = memoryWorktreeRemovals();
  const warned: string[] = [];
  const made = createWorktreeRemovalQueue(store, async (removal, force) => {
    seen.push({ path: removal.path, force });
    return answers.shift() ?? { kind: 'removed' };
  }, { info: () => {}, warn: (line) => { warned.push(line); } }, { debounceMs: 3_000, periodicMs: 300_000, backoffMs: 30_000, maxBackoffMs: 3_600_000, now: () => now });
  return { made, store, seen, warned, at: (ms: number) => { now = ms; } };
};

const tree = (path: string): Omit<WorktreeRemoval, 'requestedAt' | 'attempts' | 'nextAttemptAt'> =>
  ({ kind: 'session', owner: 'ahp-session:/s', repository: '/repo', path, branch: 'agents/x', mode: 'commit' });

describe('the worktree removal queue', () => {
  it('removes a tree and lets the record go', async () => {
    const { made, store, seen } = queue([{ kind: 'removed' }]);
    made.request(tree('/repo.worktrees/a'));
    await made.processNow(made.ofSession('ahp-session:/s'), false);
    expect(seen).toEqual([{ path: '/repo.worktrees/a', force: false }]);
    expect(store.list()).toEqual([]);
    made.stop();
  });

  it('keeps a skipped tree with its reason, and a failed one until its wait is over, doubled per attempt', async () => {
    const { made, seen, at } = queue([{ kind: 'skipped', message: 'it has changes nobody committed' }, { kind: 'failed', message: 'git said no' }, { kind: 'failed', message: 'git said no' }]);
    made.request(tree('/repo.worktrees/a'));
    await made.processNow(made.ofSession('ahp-session:/s'), false);
    expect(made.sessionStatus('ahp-session:/s', () => false)).toEqual({ state: 'skipped', message: 'it has changes nobody committed' });
    const kept = made.ofSession('ahp-session:/s')[0];
    expect(kept?.attempts).toBe(1);
    expect(kept?.nextAttemptAt).toBe(1_000 + 30_000);
    // Not due yet: a pass leaves it.
    await made.runPass();
    expect(seen).toHaveLength(1);
    at(31_000);
    await made.runPass();
    expect(made.sessionStatus('ahp-session:/s', () => false)).toEqual({ state: 'failed', message: 'git said no' });
    expect(made.ofSession('ahp-session:/s')[0]?.nextAttemptAt).toBe(31_000 + 60_000);
    made.stop();
  });

  it('answers a session by VS Code\'s order, inUse where a session uses the tree, and drops at an unarchive', async () => {
    const { made } = queue([]);
    made.request(tree('/repo.worktrees/a'));
    made.request(tree('/repo.worktrees/b'));
    expect(made.sessionStatus('ahp-session:/s', () => false)).toEqual({ state: 'pending' });
    expect(made.sessionStatus('ahp-session:/s', (one) => one.path.endsWith('/a'))).toEqual({ state: 'pending' });
    expect(made.sessionStatus('ahp-session:/s', () => true)).toEqual({ state: 'inUse' });
    made.dropSession('ahp-session:/s');
    expect(made.ofSession('ahp-session:/s')).toEqual([]);
    expect(made.sessionStatus('ahp-session:/s', () => false)).toEqual({ state: 'unknown' });
    made.stop();
  });

  it('keeps the newer request of a tree asked again while the older one ran', async () => {
    let release: (() => void) | undefined;
    const store = memoryWorktreeRemovals();
    const made = createWorktreeRemovalQueue(store, async () => {
      await new Promise<void>((done) => { release = done; });
      return { kind: 'removed' };
    }, { info: () => {}, warn: () => {} });
    made.request(tree('/repo.worktrees/a'));
    const first = made.processNow(made.ofSession('ahp-session:/s'), false);
    await new Promise((done) => { setImmediate(done); });
    made.request({ ...tree('/repo.worktrees/a'), mode: 'synced' });
    release?.();
    await first;
    expect(store.list().map((one) => one.mode)).toEqual(['synced']);
    made.stop();
  });

  it('warns from the fifth failed attempt', async () => {
    const failing: RemovalOutcome[] = Array.from({ length: 5 }, () => ({ kind: 'failed', message: 'busy' }));
    const { made, warned } = queue(failing);
    made.request(tree('/repo.worktrees/a'));
    for (let attempt = 0; attempt < 5; attempt++) await made.processNow(made.ofSession('ahp-session:/s'), false);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('(attempt 5)');
    made.stop();
  });
});
