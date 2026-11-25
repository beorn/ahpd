---
title: The sdk times a reasoning run
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/index.ts](../../../../packages/sdk/src/index.ts) - the sdk's exports"
---

## Objective

The sdk exports one timer that an agent's mapper calls when a reasoning part opens and when its run ends.

## Files

- `CREATE: packages/sdk/src/sessions/reasoning.ts` - the timer: `open(partId)` gives `startedAt`, `close(partId)` gives the `chat/reasoning` end action, `closeAll()` ends every open run.
- `UPDATE: packages/sdk/src/index.ts` - export the timer.
- `CREATE: packages/sdk/test/reasoning-timer.test.ts` - the timer's cases.

## Steps

1. Write `reasoningTimer(turnId, now)` with `open`, `close` and `closeAll`, keyed by part id.
2. Make `open` answer an ISO 8601 time, and `close` a `chat/reasoning` with empty `content` and whole-millisecond `duration`.
3. Make `close` of a part that is not open answer nothing.
4. Export it from `packages/sdk/src/index.ts`.
5. Add cases with a fixed clock: one run, two runs, a second `close`, and `closeAll`.

## Validation

- `reasoning-timer.test.ts`: the cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The timer is `packages/sdk/src/host/reasoning.ts`, on the host's own road for actions. It is not exported, since no agent calls it.
