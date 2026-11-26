---
title: The host shows a damaged session as failed and deletes it
status: done
depends: [task-01-the-store-keeps-a-damaged-file.md]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L1726-L1732](../../../../packages/sdk/src/host/catalogue.ts#L1726-L1732) - `computeSessions`, which gets the failed rows"
  - "[code://packages/sdk/src/host/lifecycle.ts#L775-L823](../../../../packages/sdk/src/host/lifecycle.ts#L775-L823) - `removeSession`, which gets a branch for a damaged id"
---

## Objective

`listSessions` shows one failed row per damaged id, and `disposeSession` on it removes the file.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:1726-1732` - add a failed row for each id of `kept.damaged?.()`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:808-823` - delete a damaged id with no agent.
- `CREATE: packages/sdk/test/session-damaged.test.ts` - the cases through a real host.

## Steps

1. Build a summary with `lifecycle: 'failed'`, `creationError` holding the reason, provider `unknown`, and no external mark.
2. Append it to `computeSessions` after the held rows, for each damaged id.
3. In `removeSession`, when the id is damaged, run `mayDispose`, then `kept.forget`, then announce the removal.
4. Write the four rows of the brief's table through `createHost` and `listSessions`.
5. Write a case for `null`, a case for a delete, and a case for a prune that leaves the file.

## Validation

- `pnpm --filter @ahpd/sdk exec vitest run test/session-damaged.test.ts test/session-delete.test.ts` passes.
- `pnpm --filter @ahpd/sdk test`, `pnpm typecheck` and `pnpm boundary` pass.

## Resume

