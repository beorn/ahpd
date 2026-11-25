---
title: The daemon fires it once
status: done
depends: [01]
layer: "server"
refs:
  - "[code://packages/server/src/scheduled.ts#L413-L439](../../../../packages/server/src/scheduled.ts#L413-L439) - `schedulesOf`"
  - "[code://packages/server/src/scheduled.ts#L615-L641](../../../../packages/server/src/scheduled.ts#L615-L641) - `fire` and its catch-up"
  - "[code://packages/sdk/src/automations/automations.ts#L636](../../../../packages/sdk/src/automations/automations.ts#L636) - the operations"
---

## Objective

A one-time automation runs once at `runAt`. After its run is created, it has no `nextRunAt` and offers no `update`.

## Files

- `UPDATE: packages/server/src/scheduled.ts:413-439` - a `oneTime` trigger gives the automation `runAt` as its next occurrence until it is consumed.
- `UPDATE: packages/server/src/scheduled.ts:615-641` - a fired one-time trigger writes `_meta['ahpd.oneTimeRun']`, and a missed one follows `misfirePolicy`.
- `UPDATE: packages/sdk/src/automations/automations.ts:636` - no `update` once `_meta['ahpd.oneTimeRun']` is set.
- `CREATE: packages/server/test/scheduled-one-time.test.ts` - the cases with a stood-in clock.

## Steps

1. Read VS Code's `_consumeOneTime` and its fire path at L1004-L1019, and record their rules in Resume.
2. Read a `oneTime` trigger in `schedulesOf` as one occurrence at `runAt`, and none once consumed.
3. Write the run's resource to `_meta['ahpd.oneTimeRun']` when the trigger's own run starts.
4. Apply `misfirePolicy` to a `runAt` that passed while the daemon was down.
5. Drop `update` from the operations of a consumed automation.
6. Refuse an update to it: "One-time automation has already started: <run>".

## Validation

- `packages/server/test/scheduled-one-time.test.ts` - one run at `runAt`, none after; a missed `runAt` runs once, or not with `skip`; no `update` once consumed.
- The server vitest suite passes.

## Resume

VS Code fires a one-time trigger at `runAt`, and at once for a passed `runAt`, unless it is a minute late and `misfirePolicy` is `skip`. It consumes the trigger when the trigger's own run is created, and then offers no `update`. `scheduled.ts` reads the trigger in `onceOf`, beside the schedules. `firedOnce` keeps one `runAt` from firing twice in a process, since a refused run leaves the trigger. The catch-up at start leaves one-time triggers to `rearm`. The sdk store writes `_meta.ahpd.oneTimeRun` in `consume`, so the mark is in the automation's own file, and drops `update`. The cases are `scheduled-one-time.test.ts`.
