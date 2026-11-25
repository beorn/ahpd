---
title: A client measures a worktree's disk usage - implemented
plan: plans/host/20261121-1907-a-client-measures-a-worktrees-disk-usage/plan.md
---

## What exists now

- `packages/sdk/src/repo/diskusage.ts` holds `measureDiskUsage`, VS Code's scan with an `AbortSignal`, `identityOf` and `slotted`.
- `vscode/measureWorktreeDiskUsage` answers `{ sizeBytes }`, or `{}` for a root that is missing or not a folder. `vscode/cancelWorktreeDiskUsage` stops a scan of the asking connection.
- `HostContext.diskUsage` holds the scans by connection and request id, the two slots every connection shares, the kept measures and the queue of each worktree.
- A connection that closes stops its scans.
- A measure asked with a `session` is kept while the session is idle and its `modifiedAt` and the folder's identity stand.
- Both methods need `file:list`, and the initialize `_meta` advertises `vscode.worktreeDiskUsage`.
- The catalogue's `rowOf` is on the host context, for the session's `modifiedAt`.

## Verified

- `packages/sdk/test/worktree-disk-usage.test.ts` - the bytes of a tree with links in and out, a missing root, a cancel, the method and its capability.
- The same file - the refusals, a request id in use, a cancel over the method, and a session's kept measure until its turn.

## Departures from the plan

- A cancelled scan answers an internal error with the message `Canceled`, the message of VS Code's `CancellationError`.
