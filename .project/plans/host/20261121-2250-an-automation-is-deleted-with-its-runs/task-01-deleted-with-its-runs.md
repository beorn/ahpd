---
title: An automation is deleted, with its runs on request
status: done
depends: []
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L4003-L4031`, the checks
---

## Objective

`vscode/deleteAutomation` removes an automation and, with `deleteHistory: true`, deletes the sessions of its runs and of `legacySessions`.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the method and its checks.
- `UPDATE: packages/sdk/src/host/automations.ts` - the run sessions to delete, and the deletion.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the three `vscode.automationHistory*` flags.
- `UPDATE: packages/sdk/src/host/gate.ts` - `automation:remove` for both methods.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/automation-delete.test.ts` - the deletion and the refusals.

## Steps

1. Check the URI, and refuse `legacySessions` without `deleteHistory`.
2. Answer `[]` for an automation the store does not know and no receipt names.
3. Refuse an automation with a run that is active or recovering.
4. Collect the sessions whose kept automation origin names it, and add `legacySessions`, unless it is a chat automation.
5. Remove the definition through the store, as the remove action does.
6. With `deleteHistory`, delete each collected session with `removeSession`.
7. Answer the URIs of the sessions deleted.

## Validation

- `packages/sdk/test/automation-delete.test.ts` - with and without `deleteHistory`, and each refusal.
- The sdk vitest suite passes.

## Resume
