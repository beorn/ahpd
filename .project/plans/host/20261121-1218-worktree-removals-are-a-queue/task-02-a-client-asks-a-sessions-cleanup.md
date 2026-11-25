---
title: A client asks a session's cleanup
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts#L889](../../../../packages/sdk/src/host/vscodemethods.ts#L889) - the `vscode/*` handlers"
---

## Objective

`vscode/sessionWorktreeCleanup` and `vscode/prepareSessionWorktreeCleanup` answer as VS Code's host does, and the initialize `_meta` advertises them.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the two methods.
- `UPDATE: packages/sdk/src/host/gate.ts` - their grants.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the three capability keys.
- `CREATE: packages/sdk/test/worktree-cleanup-methods.test.ts` - the status, the retry, the force and the refusals.

## Steps

1. Answer `vscode/sessionWorktreeCleanup` with the first status of the session's records in VS Code's order.
2. Refuse `force` without `retry`, and `retry` for a session that is not archived, in VS Code's words.
3. On `retry`, prepare and request the removal again.
4. On `force`, process the records now with force, and refuse with the last message when one remains.
5. Answer `vscode/prepareSessionWorktreeCleanup` for an existing session, recording a managed working directory it has no record of.
6. Advertise `vscode.worktreeCleanup`, `vscode.forceWorktreeCleanup` and `vscode.prepareSessionWorktreeCleanup`.

## Validation

- `packages/sdk/test/worktree-cleanup-methods.test.ts` - each answer and refusal.
- The sdk vitest suite passes.

## Resume
