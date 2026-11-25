---
title: An automation is deleted with its runs - implemented
date: 2026-11-21
refs:
  - git://1466c5539
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts)"
  - "[code://packages/sdk/src/automations/automations.ts](../../../../packages/sdk/src/automations/automations.ts)"
  - "[code://packages/server/src/scheduled.ts](../../../../packages/server/src/scheduled.ts)"
---

A client can now delete an automation and, when it asks with `deleteHistory: true`, the sessions its runs made. A request that carries a `requestId` keeps the list of deleted sessions, so a retry after a lost answer reads the same list until `vscode/acknowledgeAutomationDeletion` drops it. A deletion that was still running when the daemon stopped is written beside the definitions and finished when the next daemon starts. The plain `automation/removed` action keeps its old behaviour and leaves every run session in place.

## What was built

- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - `vscode/deleteAutomation` with its URI and `legacySessions` checks, its `requestId`, and the caller's principal handed to the deletion, and `vscode/acknowledgeAutomationDeletion`.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - the sessions a deletion takes, every one of them checked against the requester before the automation goes, the one deletion promise per automation, a second request joined to it, the receipt answered before the store is asked, the acknowledgement, and the pending deletions a start finishes as the requester they kept.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `mayDispose` on the lifecycle port, so a caller that deletes several sessions asks about all of them before it deletes any.
- [`code://packages/sdk/src/automations/automations.ts`](../../../../packages/sdk/src/automations/automations.ts) - deletions in progress, their requester and their receipts in the memory store, persisted before each change through the store's `persist`.
- [`code://packages/sdk/src/types/automations.ts`](../../../../packages/sdk/src/types/automations.ts) - `AutomationDeletion` with its `requester`, `AutomationDeletionReceipt`, and the optional store methods that keep them.
- [`code://packages/server/src/scheduled.ts`](../../../../packages/server/src/scheduled.ts) - `deletions` and `deletionReceipts` read from the state file, the requester kept only where it is a string, restored into the inner store, written back when non-empty, and the state read moved before the inner store is built.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `vscode.automationHistory`, `vscode.automationHistoryReceipts` and `vscode.automationHistoryDeletionState`.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `automation:remove` for both methods.

## Verified

- `packages/sdk/test/automation-delete.test.ts` - 16 tests: the deletion with and without the history, the catalogue action, `legacySessions`, another person's session in `legacySessions` refused whole, the caller's own deleted, a chat automation, an unknown automation, an active run, bad URIs, the `legacySessions` refusals, the flags, a repeat from a receipt, its acknowledgement, a second request joined and refused, a deletion finished after a restart, and a resumed deletion run as the requester it kept.
- `packages/sdk/test/users-gate-tables.test.ts` - 4 tests, with the served count at 62.
- `packages/server/test/automation-files.test.ts` - 26 tests, including the new one for a deletion and its receipt written beside the definitions and read back.
- The sdk suite: 268 files, 5210 passed, 5 skipped.
- The server suite: 102 files, 2007 passed, 3 skipped.
- `pnpm typecheck` and `pnpm boundary` pass.

## Departures from the plan

- The lock invocation was denied in the build session, so the `packages/sdk` and `packages/server` suites there ran as `npx vitest run <path>`, one at a time. The owner re-runs every suite under the lock, and the counts above are from the build session.
- A second request without `deleteHistory` while a deletion runs is refused with `Automation deletion is already in progress: <automation>`. The plan decided the refusal but not its words.
- A second request's `legacySessions` are not added to a deletion already running; only its request id joins, because the running deletion's session list is fixed when it starts. The plan says a second request is added to the running deletion and does not say what its own sessions mean.
- A receipt answers only a request that names the same automation. A reused `requestId` for another automation is treated as a new request, and its answer replaces the receipt. The plan does not decide this case.
- The deletion methods are optional on `AutomationStore`, so a store that keeps no receipts still serves the deletion, one request at a time and without a repeatable answer.
- The `automation/removed` action checks only that the automation offers the `remove` operation and has no per-automation ownership check, so `vscode/deleteAutomation` mirrors that check and adds none. The sessions are the only part gated per person.
- Finishing pending deletions calls `ctx.refresh()` once before the sessions are deleted, so a session this daemon only lists has a backend that answers for it. The plan does not name this step.
- `packages/server/test/automation-files.test.ts` was extended although the task's Files named only the sdk test, so the file persistence of deletions and receipts is covered.

## Left for later

- The owner re-runs the `packages/sdk` and `packages/server` suites under the lock; a failure is fixed from those results. Nothing else the plan named is undone.
