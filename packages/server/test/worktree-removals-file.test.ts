import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileWorktreeRemovals } from '../src/worktreeremovals.js';
import type { WorktreeRemoval } from '@ahpd/sdk';

/* The worktree removals a restart tries again, kept in a file. */

const made: string[] = [];
afterEach(async () => { for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true }); });

const folder = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-removals-'));
  made.push(dir);
  return dir;
};

const one: WorktreeRemoval = {
  kind: 'session', owner: 'ahp-session:/one', repository: '/r', path: '/r.worktrees/one', branch: 'agents/one',
  mode: 'commit', requestedAt: 1, attempts: 2, nextAttemptAt: 3, lastAttempt: { state: 'failed', message: 'refused' },
};

describe('the worktree removal file', () => {
  it('keeps a record through a reopen, and lets a deleted one go', () => {
    const file = join(folder(), 'worktree-removals.json');
    const first = fileWorktreeRemovals(file);
    first.put(one);
    first.put({ ...one, kind: 'managed', owner: '/r.worktrees/two', path: '/r.worktrees/two' });
    first.delete('managed', '/r.worktrees/two', '/r.worktrees/two');
    expect(fileWorktreeRemovals(file).list()).toEqual([one]);
  });

  it('starts empty from a file it cannot read, and says so', () => {
    const file = join(folder(), 'worktree-removals.json');
    writeFileSync(file, JSON.stringify({ version: 9, removals: [one] }));
    const told: string[] = [];
    expect(fileWorktreeRemovals(file, (line) => { told.push(line); }).list()).toEqual([]);
    expect(told).toHaveLength(1);
  });
});
