---
title: A backend start reads its folder
status: done
depends: [task-01-the-changes-port-takes-the-id.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L2151-L2172](../../../../packages/sdk/src/host/spawn.ts#L2151-L2172) - the baseline checkpoint at the backend start"
  - "[code://packages/sdk/src/host/spawn.ts#L1912-L1925](../../../../packages/sdk/src/host/spawn.ts#L1912-L1925) - the turn's end, which reads the folder after its checkpoint"
---

## Objective

When a session's backend starts, the host reads the session's folder after the baseline checkpoint, as a turn's end does. A session in a folder the daemon has not read offers its Uncommitted Changes at once.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:2166-2172` - after the baseline is written, call `refreshFacts(dir)`, or `bringBackOf(uri)` first for a session in a machine, as the turn's end does.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - a session started in a folder the host has not read.

## Steps

1. In the backend start, chain `refreshFacts(held.workingDirectory)` after `written`, beside `refreshSessionChangesSummary(uri)`.
2. Copy the turn end's branch for a session that entered a machine: `bringBackOf(uri)` before the read.
3. Add a case: the host makes a worktree after start, and a session there runs only a command.
4. Check that its catalogue offers `uncommitted` before any turn ends.

## Validation

- `changes-refresh.test.ts`: the new case.
- Run the sdk suite under the lock, then the computer suite.
- The computer suite covers a session in a machine, which takes the `bringBackOf` path.

## Resume

Done on 2026-11-23. The start reads the folder without `bringBackOf`: the session has done no work yet, and the bring-back added a machine read.
