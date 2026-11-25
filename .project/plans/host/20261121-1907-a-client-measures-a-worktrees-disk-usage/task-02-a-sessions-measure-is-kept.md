---
title: A session's measure is kept until it changes
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the measure method of task 01"
---

## Objective

A measure asked with a `session` is answered again from memory while the session has not changed and runs no turn.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the cache by session and worktree, and one ask at a time per worktree.
- `UPDATE: packages/sdk/test/worktree-disk-usage.test.ts` - the cached answer and its end.

## Steps

1. Key a kept answer by the session, the worktree, the session's `modifiedAt` and the root's device, inode and birth time.
2. Measure again when the session runs a turn, or when any part of the key moved.
3. Queue two asks of one worktree with a session one behind the other.

## Validation

- `packages/sdk/test/worktree-disk-usage.test.ts` - a second ask answered without a scan, and a scan again after the session changed.
- The sdk vitest suite passes.

## Resume
