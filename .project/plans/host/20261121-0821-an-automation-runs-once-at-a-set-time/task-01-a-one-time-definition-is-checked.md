---
title: A one-time definition is advertised and checked
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L491-L497](../../../../packages/sdk/src/host/handshake.ts#L491-L497) - the capabilities"
  - "[code://packages/sdk/src/host/actions.ts#L729-L760](../../../../packages/sdk/src/host/actions.ts#L729-L760) - the create and update checks"
---

## Objective

The host advertises `oneTime: {}`, and refuses a one-time definition that VS Code refuses, in VS Code's words.

## Files

- `CREATE: packages/sdk/src/types/automations-next.ts` - the AHP 1.2.0 automation types ahpd uses before the package has them, with the AHP commit they come from.
- `UPDATE: packages/sdk/src/host/handshake.ts:491-497` - `oneTime: {}` beside `schedules`.
- `UPDATE: packages/sdk/src/host/actions.ts:729-760` - the one-time checks on a create and an update.
- `CREATE: packages/sdk/test/automation-one-time.test.ts` - the capability and the refusals.

## Steps

1. Copy `AutomationOneTimeTrigger`, `AutomationOneTimeCapability` and the `OneTime` trigger kind from AHP `e36b0a20` into `automations-next.ts`.
2. Add `oneTime: {}` to the advertised automation capabilities.
3. Refuse a one-time definition with more than one trigger: "A one-time automation must have exactly one trigger."
4. Refuse a one-time definition with disable conditions: "One-time automations do not support end dates."
5. Refuse a `runAt` that is not an ISO 8601 time.

## Validation

- `packages/sdk/test/automation-one-time.test.ts` - the handshake advertises `oneTime`, and each refusal says VS Code's words.
- The sdk vitest suite passes.

## Resume

`types/automations-next.ts` holds the one-time types from AHP `e36b0a20`. `automations/onetime.ts` holds `oneTimeProblem` and the readers. The handshake advertises `oneTime: {}`. `actions.ts` refuses a one-time definition with two triggers, an end date, or a `runAt` that is no time. It refuses an update once the trigger has run. The cases are *a one-time automation* in `automations.test.ts`.
