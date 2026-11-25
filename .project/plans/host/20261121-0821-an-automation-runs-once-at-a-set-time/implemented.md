---
title: An automation runs once at a set time - implemented
date: 2026-11-21
refs:
  - "[code://packages/sdk/src/automations/onetime.ts](../../../../packages/sdk/src/automations/onetime.ts) - the checks and the consumed mark"
  - "[code://packages/sdk/src/types/automations-next.ts](../../../../packages/sdk/src/types/automations-next.ts) - the AHP 1.2.0 types"
  - "[code://packages/server/src/scheduled.ts](../../../../packages/server/src/scheduled.ts) - `onceOf`, the clock's reading of the trigger"
---

An automation can run once at a set time, with AHP 1.2.0's `oneTime` trigger. The host advertises it and checks a definition as VS Code does. The daemon fires it once, and the automation then takes no update.

## What was built

- [`code://packages/sdk/src/types/automations-next.ts`](../../../../packages/sdk/src/types/automations-next.ts) - `AutomationOneTimeTrigger` and its capability, from AHP `e36b0a20`.
- [`code://packages/sdk/src/automations/onetime.ts`](../../../../packages/sdk/src/automations/onetime.ts) - `oneTimeProblem`, `oneTimeRunOf` and `consumedBy`.
- [`code://packages/sdk/src/automations/automations.ts`](../../../../packages/sdk/src/automations/automations.ts) - the trigger's own run consumes it, a second fire is refused, and `update` goes.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the refusals on a create and an update.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `oneTime: {}`.
- [`code://packages/server/src/scheduled.ts`](../../../../packages/server/src/scheduled.ts) - `onceOf` and `firedOnce`.
- `docs/sdk/AUTOMATIONS.md` and `docs/sdk/AHP.md` - the trigger, its operations and its refusals.

## Verified

- `scheduled-one-time.test.ts` and *a one-time automation* in `automations.test.ts` pass.
- The server suite passes, 1992 cases. The sdk suite passed 5114 of 5115 cases; `wire.test.ts` then took the `oneTime` departure, and passes.
- Typecheck and boundary pass.

## Departures from the plan

- The consumed mark is the definition's `_meta.ahpd.oneTimeRun`, beside `pinnedSession`, where VS Code uses the entry's `_meta`. The definition is what the daemon's file keeps, so a restart reads it back.
