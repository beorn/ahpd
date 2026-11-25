---
title: The host shell tool moves a sync command
status: done
depends: [task-01-a-call-offers-to-move.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/shell.ts#L294-L341](../../../../packages/sdk/src/tools/shell.ts#L294-L341) - the `async` path with its row, and the `sync` path"
  - "[code://packages/sdk/src/host/shells.ts#L349-L390](../../../../packages/sdk/src/host/shells.ts#L349-L390) - `start`, which waits for the real end and wakes the chat"
  - "[code://packages/sdk/src/host/shells.ts#L400-L420](../../../../packages/sdk/src/host/shells.ts#L400-L420) - `hold`, which this task replaces for a let-go command"
  - "[code://packages/sdk/src/machines/shellcommand.ts#L159-L164](../../../../packages/sdk/src/machines/shellcommand.ts#L159-L164) - `narrowed`, VS Code's let-go"
---

## Objective

A `sync` command of the host shell tool offers to move while it runs.
A moved command and a command let go by VS Code's narrowed claim act the same.
Each answers its model at once, gets the row of an `async` command, and wakes the chat at its end.

## Files

- `UPDATE: packages/sdk/src/tools/shell.ts:294-341` - offer the `sync` call through `at.movable()`, and give a let-go command the `async` row.
- `UPDATE: packages/sdk/src/host/shells.ts:349-420` - add a way to let a running command go on: the wake at its end that `start` has, in place of `hold`.
- `UPDATE: packages/sdk/src/host/shellcommand.ts` - end a running `run` as `background` when asked, as a narrowed claim ends it.
- `UPDATE: packages/sdk/src/types/shells.ts` - `GoingOn`, the optional fourth argument of `run`.
- `CREATE: packages/sdk/test/shell-move.test.ts` - a moved command, a command that answered first, and a narrowed one.

## Steps

1. Move the row-building of the `async` path into one function that both paths call.
2. Add to `shells` a call that lets a running command go on.
3. Make that call wake the chat at the command's end, with the tail of `start`.
4. Give `run` a way to finish as `background` from outside, beside the narrowed claim.
5. In the `sync` path, offer the call through `at.movable()` before `run`.
6. Make its `move` finish `run` as `background` and answer the row id.
7. On a `background` result, set the row.
8. Let the command go on through the new call, in place of `shells.hold`.
9. Withdraw the offer when `run` answers any other way.
10. Keep the model's answer for a let-go command as it is.
11. Write the tests.

## Validation

- `packages/sdk/test/shell-move.test.ts` holds these cases:
  - A moved `sync` command answers at once and sets a row with a stop.
  - Its end removes the row and wakes the chat once.
  - A narrowed claim does the same.
  - A command that ends first answers `false` to the move.
- `npx vitest run packages/sdk/test/shell-move.test.ts packages/sdk/test/shell-tools.test.ts packages/sdk/test/shell-async.test.ts` passes.

## Resume

Done on 2026-11-21.

- `executeShellCommand` takes `letGo` and `afterwards`. With `afterwards`, it goes on watching a command it answered `background` and reports the real end with its output. The end detection stays in one place.
- `shells.run` takes `GoingOn { letGo, ended }`. It wakes the chat at the end through `wakeWith`, which `start` now shares.
- A let-go command no longer goes through `shells.hold`. An `altBuffer` answer still does.
- The `async` path reports `moved` too, so its call names its row.
- Step 9 is not built: the offer stands until the call completes, where the host takes the flag off. A move after the answer finds the call answered and answers `false`. A withdraw there was one more content change for nothing.

