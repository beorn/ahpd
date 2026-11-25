---
title: A removal is a record a pass works through
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L1784-L1854](../../../../packages/sdk/src/host/lifecycle.ts#L1784-L1854) - the removal today"
---

## Objective

An archived session's trees are removed through records that a pass works through, kept across a restart and tried again.

## Files

- `CREATE: packages/sdk/src/host/worktreeremovals.ts` - the record, the memory port, and the pass with its waits.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.worktreeRemovals`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:1784-1854` - a request writes records; today's checks run in the pass.
- `CREATE: packages/server/src/worktreeremovals.ts` - the file port in the state folder.
- `UPDATE: packages/server/src/commands/run.ts` - the daemon hands the file port to the host.
- `CREATE: packages/sdk/test/worktree-removals.test.ts` - the queue's cases with a stood-in clock.

## Steps

1. Read VS Code's `_process` and `_scheduleNext`, and record their rules in Resume.
2. Write a record per tree in `requestSessionWorktreeRemoval`, replacing any record of the same tree.
3. Run a pass 3 s after a request, then every 5 minutes while records remain.
4. Process a due record under the session's lock, with today's checks: `skipped` and `inUse` keep it, success removes it.
5. Set a failed record's next attempt 30 s ahead, doubled per attempt up to an hour.
6. Drop a session's records at unarchive and at restore.
7. Keep the records through a file port in the daemon's state folder.

## Validation

- `packages/sdk/test/worktree-removals.test.ts` - a removal, a skip, a failure with its wait, and an unarchive.
- The sdk vitest suite passes.

## Resume
