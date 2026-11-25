---
title: A client lists and removes managed worktrees
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts#L889](../../../../packages/sdk/src/host/vscodemethods.ts#L889) - the `vscode/*` handlers"
---

## Objective

`vscode/listManagedWorktrees` lists the worktrees this host made in given repositories, each with its cleanup status, and `vscode/cleanupManagedWorktree` removes one.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the two methods.
- `UPDATE: packages/sdk/src/host/gate.ts` - their grants.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.managedWorktrees`.
- `CREATE: packages/sdk/test/managed-worktrees.test.ts` - a real repository with an orphan.

## Steps

1. List each repository's linked worktrees, and keep the managed ones.
2. Give each the status of its record, `inUse` where a session's record names it, or `unknown`.
3. Refuse a cleanup of a worktree that is not managed, or whose branch moved.
4. Refuse a cleanup of a worktree in use, unless `force`.
5. Write a managed record, and process it now when `force`.
6. Advertise `vscode.managedWorktrees`.

## Validation

- `packages/sdk/test/managed-worktrees.test.ts` - an orphan listed and removed, and each refusal.
- The sdk vitest suite passes.

## Resume
