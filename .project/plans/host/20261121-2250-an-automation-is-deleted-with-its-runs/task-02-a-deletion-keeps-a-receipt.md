---
title: A deletion keeps a receipt until acknowledged
status: done
depends: [task-01-deleted-with-its-runs.md]
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostAutomationService.ts#L477-L560`, receipts and deletions in progress
---

## Objective

A deletion with a `requestId` keeps its list of deleted sessions, so a retry answers it, until `vscode/acknowledgeAutomationDeletion` drops it.

## Files

- `UPDATE: packages/sdk/src/automations/automations.ts` - receipts and deletions in progress, through the store's `persist`.
- `UPDATE: packages/server/src/scheduled.ts` - write and read them beside the definitions.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - `vscode/acknowledgeAutomationDeletion`.
- `UPDATE: packages/sdk/test/automation-delete.test.ts` - receipts, a restart, and a second request.

## Steps

1. Keep each deletion in progress, with its sessions and its request ids, in the server's automation file.
2. Keep a receipt by request id when a deletion ends.
3. Answer a known request id for a removed automation from its receipt.
4. Add a second request for the same automation to its running deletion.
5. Refuse a second request without `deleteHistory` while a deletion runs.
6. Finish a deletion in progress after a restart.
7. Drop the receipt on `vscode/acknowledgeAutomationDeletion`.

## Validation

- `packages/sdk/test/automation-delete.test.ts` - a repeat, an acknowledgement, and a restart midway.
- The sdk vitest suite passes.

## Resume

Done. `AutomationDeletion` and `AutomationDeletionReceipt` are optional store methods; `memoryAutomations` keeps both maps and hands them to `persist` before each change. `scheduledAutomations` reads them beside the definitions, writes them when non-empty, and restores them at startup. The host keeps one promise per automation, joins a second request to a deletion in progress, refuses one without `deleteHistory`, answers a known `requestId` from its receipt, resumes pending deletions at startup, and drops a receipt on `vscode/acknowledgeAutomationDeletion`.
