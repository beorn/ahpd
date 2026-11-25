---
title: A connector's wake goes through request
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L1365-L1398](../../../../packages/sdk/src/host/automations.ts#L1365-L1398) - `runOne`"
  - "[code://packages/sdk/src/host/automations.ts#L614-L640](../../../../packages/sdk/src/host/automations.ts#L614-L640) - `request`"
---

## Objective

`runOne` starts no run itself: it hands the wake to `request`, which counts it and applies the overlap mode.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts:1365-1398` - `runOne` calls `request` with `byEvent: true` in place of `fly`.
- `UPDATE: packages/sdk/test/plugin-triggers.test.ts` - the cases of a plugin's `runAutomation` past the cap and under each overlap mode, where the plugin host is already driven.
- `UPDATE: docs/sdk/AUTOMATIONS.md:183-188` - a run a connector asks for counts as an event's.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. In `runOne`, replace `void fly(resource, origin, facts, said)` with `request(resource, origin, facts, said, true)`.
2. Keep the owner, switch and reader checks of `runOne` before the call, with their log lines.
3. Add a case: a `pluginTriggers` entry's `run`, called 25 times for a `parallel` automation, starts 20 runs.
4. Add a case: the same calls for a `queue` automation start one run, and the rest wait for it.
5. Add a case: a call for a `skip` automation while a run is going starts nothing, and is not counted.
6. Say in *What stops a wake* in `AUTOMATIONS.md` that a run a connector asks for counts as an event's.
7. Add a line to the unreleased notes.

## Validation

- The case of step 3 passes, and fails without step 1.
- The sdk suite, the computer suite and the webhook suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

