---
title: The moved-tree case waits by the clock
status: done
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/worktrees.test.ts#L1263-L1270](../../../../packages/sdk/test/worktrees.test.ts#L1263-L1270) - `logged`"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`"
---

## Objective

`logged` waits by `WAIT_MS`, and the moved-tree case has a budget its git work fits in on a slow Windows runner.

## Files

- `UPDATE: packages/sdk/test/worktrees.test.ts:1263-1270` - `logged` waits until `WAIT_MS` has passed.
- `UPDATE: packages/sdk/test/worktrees.test.ts:1346` - the case's timeout, 60 s on Windows.

## Steps

1. Make `logged` poll every 25 ms until `WAIT_MS` has passed, as `waitFor` in `changes-refresh.test.ts` does.
2. Give the moved-tree case a third argument of 60 000 ms on Windows and the default elsewhere.

## Validation

- Run `worktrees.test.ts` on this machine, and read the case's time against its timings on Windows.
- Run the sdk suite as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`logged` polls every 25 ms until `WAIT_MS`, and looks once more before it fails.
The case takes 370 ms on this machine; its Windows budget is 60 s.
