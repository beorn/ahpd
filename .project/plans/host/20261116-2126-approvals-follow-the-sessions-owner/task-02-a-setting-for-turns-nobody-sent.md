---
title: A setting for turns nobody sent
status: done
depends: [task-01-the-owners-turns-get-the-approvals.md]
layer: sdk, server
refs:
  - "[code://packages/sdk/src/types/host.ts#L1013](../../../../packages/sdk/src/types/host.ts#L1013) - `eligibleForAutoApproval`, the option the new one sits beside"
  - "[code://packages/server/src/commands/options.ts#L560](../../../../packages/server/src/commands/options.ts#L560) - a file-only setting's declaration"
  - "[code://packages/server/src/commands/run.ts#L1563](../../../../packages/server/src/commands/run.ts#L1563) - where the daemon hands the option to `createHost`"
---

## Objective

`unattendedAutoApprove` in `config.json` decides what a turn nobody sent gets on a host with users.
On, the default, it gets the owner's approvals; off, it gets none.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:1013` - `unattendedAutoApprove?: boolean` on `HostOptions`, with its doc comment.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `approvesFor` answers the setting for a turn with no sender.
- `UPDATE: packages/server/src/commands/options.ts:560` - the setting, file only, a boolean, `true` by default.
- `UPDATE: packages/server/src/commands/run.ts:1563` - the daemon hands it to `createHost`.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the cases of a turn with no sender.
- `UPDATE: packages/server/test/config-check.test.ts` - the setting's value check.

## Steps

1. Add `unattendedAutoApprove` to `HostOptions`, and say that it counts only on a host with users.
2. In `approvesFor`, answer `options.unattendedAutoApprove !== false` for a turn with no sender.
3. Declare the setting in `options.ts` as a boolean read from the file only, `true` by default.
4. Stop the start on a value that is not a boolean, as the other file-only settings do.
5. Hand the setting to `createHost` in `run.ts`.

## Validation

- `host-permissions.test.ts`: an automation's turn on a host with users runs `pnpm ls` with no question by default.
- `host-permissions.test.ts`: with `unattendedAutoApprove: false`, the same turn asks.
- `config-check.test.ts`: a value that is not a boolean stops the start.
- The sdk suite and the server suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- The key is also on the file's `Config` type, which `config-check.test.ts` holds equal to the schema.
- `host-trust.test.ts` covers an automation's trust with the setting on and off.

