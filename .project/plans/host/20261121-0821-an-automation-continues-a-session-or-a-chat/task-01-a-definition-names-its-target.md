---
title: A definition names its target
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L117-L125](../../../../packages/sdk/src/host/automations.ts#L117-L125) - `wakeOf`"
  - "[code://packages/sdk/src/host/handshake.ts#L491-L497](../../../../packages/sdk/src/host/handshake.ts#L491-L497) - the capabilities"
---

## Objective

The host advertises both targets, and reads where an automation's runs go from `target`, or from the old pinned mode.

## Files

- `UPDATE: packages/sdk/src/types/automations-next.ts` - `AutomationTarget`, its three kinds and `AutomationTargetsCapabilities`, from AHP `e36b0a20`.
- `UPDATE: packages/sdk/src/host/automations.ts:117-125` - `targetOf`, beside `wakeOf`.
- `UPDATE: packages/sdk/src/host/handshake.ts:491-497` - `targets: { previousSession: {}, chat: {} }`.
- `UPDATE: packages/sdk/src/host/actions.ts` - an unknown target kind is refused on a create and an update.
- `CREATE: packages/sdk/test/automation-targets.test.ts` - the capability, `targetOf` and the refusal.

## Steps

1. Copy the target types into `automations-next.ts`.
2. Add `targetOf(definition)`: `target.kind` when set, `previousSession` for `_meta.ahpd.session: 'pinned'`, otherwise `newSession`.
3. Read `targetOf` wherever `wakeOf(...).session` decides a pinned run.
4. Advertise both targets.
5. Refuse an unknown target kind: "Automation target is not available: <kind>".

## Validation

- `packages/sdk/test/automation-targets.test.ts` - the capability, the three readings of `targetOf`, and the refusal.
- The sdk vitest suite passes.

## Resume

`types/automations-next.ts` holds the target types. `automations/targets.ts` holds `targetOf`, `continues`, `targetProblem` and `retargeted`. `wakeOf` reads `targetOf`, so a `previousSession` target and the older `pinned` mode take one path. The handshake advertises `targets: { previousSession: {}, chat: {} }`, and the wire check records it as a departure from 1.1.0.
