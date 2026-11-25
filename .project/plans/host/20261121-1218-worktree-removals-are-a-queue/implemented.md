---
title: Worktree removals are a queue - implemented
plan: plans/host/20261121-1218-worktree-removals-are-a-queue/plan.md
---

## What exists now

- `packages/sdk/src/host/worktreeremovals.ts` holds the record, the memory store and the queue. A pass runs 3 s after a request, and every 5 minutes while records remain. A failed record waits 30 s, doubled per attempt up to an hour, and the log warns from the fifth attempt.
- `requestSessionWorktreeRemoval` writes one record per tree and runs the first attempt at once. The mode is `synced` when the host archived the session itself, and `commit` otherwise. The checks it made before now run in the pass: a kept tree is `skipped` with its reason.
- An unarchive and a restore drop the session's records.
- The daemon keeps the records in `worktree-removals.json` beside its configuration, through `packages/server/src/worktreeremovals.ts`.
- `vscode/sessionWorktreeCleanup` answers a session's status in VS Code's order, retries, and forces. `vscode/prepareSessionWorktreeCleanup` records a managed working directory that a session has no tree record of.
- `vscode/listManagedWorktrees` lists the worktrees this host made in each repository, with a status. `vscode/cleanupManagedWorktree` removes one, keeping its branch.
- The `Worktrees` port gained `list` and a `force` argument to `remove`.
- The initialize `_meta` advertises the four keys when the host makes worktrees.

## Verified

- `packages/sdk/test/worktree-removals.test.ts` - the queue with a stood-in clock.
- `packages/sdk/test/worktree-cleanup-methods.test.ts` - each answer and refusal of the session methods, against a real repository.
- `packages/sdk/test/managed-worktrees.test.ts` - an orphan listed and removed, a foreign worktree and a moved branch refused, a worktree in use.
- `packages/server/test/worktree-removals-file.test.ts` - the records kept through a reopen.
- The existing `worktrees.test.ts` and `host-merged.test.ts` cases pass unchanged.

## Departures from the plan

- A managed worktree is also one in the folder `worktreesRoot` names, because the host makes its trees there when it is set. VS Code has no such setting.
- A managed worktree with uncommitted work is committed on its branch before it goes, where the port can commit. VS Code does the same in its `_process`.
- A tree is in use when a session records it, a window holds it as a detached worktree, or a listed session works in it. The last check is the existing `treeInUse`, so a session nobody has spoken in yet does not count.
