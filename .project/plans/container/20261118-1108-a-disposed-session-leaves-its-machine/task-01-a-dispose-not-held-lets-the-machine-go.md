---
title: A dispose of a session not held lets its machine go
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L851-L858](../../../../packages/sdk/src/host/lifecycle.ts#L851-L858) - the branch for a session not held"
  - "[code://packages/sdk/src/host/catalogue.ts#L1505-L1517](../../../../packages/sdk/src/host/catalogue.ts#L1505-L1517) - the pattern"
---

## Objective

The `held === undefined` branch of `removeSession` tells the port that the session left its machine.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts:851-858` - the branch reads the config, forgets the row, and calls `ctx.leaveForgotten`.
- `UPDATE: packages/sdk/test/computer-bringback.test.ts` - the case of a dispose of a session not held.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. In the branch, read `kept.config(idOf(uri))` before `kept.forget`.
2. After the row goes, call `ctx.leaveForgotten(uri, config)`.
3. Add a case: dispose a session in a machine that no process holds, and expect `leave` for it.
4. Add a case: dispose a session in no machine that no process holds, and expect no `leave`.
5. Add a line to the unreleased notes.

## Validation

- The case of step 3 passes, and fails without step 2.
- The sdk suite and the computer suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

