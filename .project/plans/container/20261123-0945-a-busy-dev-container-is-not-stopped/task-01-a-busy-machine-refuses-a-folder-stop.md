---
title: A busy machine refuses a folder stop
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L2342-L2363](../../../../packages/computer/src/plugin.ts#L2342-L2363) - `enter` and `leave`"
  - "[code://packages/computer/src/plugin.ts#L2506-L2523](../../../../packages/computer/src/plugin.ts#L2506-L2523) - the folder's `stop` and `remove`"
---

## Objective

The plugin knows the sessions in each of its machines. The folder's `stop` and `remove` answer `false` and act on nothing while that set is not empty.

## Files

- `UPDATE: packages/computer/src/plugin.ts:2342-2363` - `enter` and `leave` keep a set per machine for every machine; the disposable delay still reads its own.
- `UPDATE: packages/computer/src/plugin.ts:2506-2523` - `stop` and `remove` answer `false` when the found machine's set is not empty.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the refusal and the stop after the session leaves.

## Steps

1. Add a map from machine id to session ids, beside `disposables`.
2. In `enter`, add the session to the map for any id; keep the disposable branch as it is.
3. In `leave`, remove the session from the map for any id; keep the disposable branch as it is.
4. In the folder's `stop` and `remove`, answer `false` before `made.stop` or `made.remove` when the found machine has sessions.
5. Add a case: a session enters a folder's machine by `computer://<id>`.
6. Check that a folder stop answers `false` and the machine still runs.
7. Add a case where the session leaves, and the folder stop answers `true` and stops the machine.

## Validation

- `computer-devcontainer.test.ts`: the two new cases.
- Run the computer suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-23, as written.
