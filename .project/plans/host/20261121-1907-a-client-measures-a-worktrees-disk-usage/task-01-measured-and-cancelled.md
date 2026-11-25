---
title: A worktree's disk usage is measured and cancelled
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` handlers"
---

## Objective

`vscode/measureWorktreeDiskUsage` answers a folder's reclaimable bytes, and `vscode/cancelWorktreeDiskUsage` stops a scan in flight.

## Files

- `CREATE: packages/sdk/src/repo/diskusage.ts` - the scan, as VS Code's `measureWorktreeDiskUsage`, with a cancel signal.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the two methods, the scans by connection and request id, the slot of two.
- `UPDATE: packages/sdk/src/host/gate.ts` - `file:list` for both.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.worktreeDiskUsage` in the initialize `_meta`.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/worktree-disk-usage.test.ts` - the scan and the methods.

## Steps

1. Port VS Code's scan to `repo/diskusage.ts`, with an `AbortSignal` in place of the cancellation token.
2. Refuse a `uri` that is not an absolute `file:` URI, and a request id already in use on the connection.
3. Run at most two scans at once, and stop a scan on its cancel or when its connection closes.
4. Answer `{ sizeBytes }`, or `{}` for a root that is missing or not a folder.
5. Advertise `vscode.worktreeDiskUsage`, and give both methods `file:list`.

## Validation

- `packages/sdk/test/worktree-disk-usage.test.ts` - the bytes of a tree with a symlink and a hard link out of it.
- The same file - a cancel, a used request id and a bad URI.
- The sdk vitest suite passes.

## Resume
