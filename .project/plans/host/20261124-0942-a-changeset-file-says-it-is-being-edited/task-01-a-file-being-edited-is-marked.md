---
title: A file being edited is marked
status: done
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/types/changes.ts#L532](../../../../packages/sdk/src/types/changes.ts#L532) - `observe`"
  - "[code://packages/sdk/src/sessions/changes.ts#L712-L740](../../../../packages/sdk/src/sessions/changes.ts#L712-L740) - `rowsOf`"
  - "[code://packages/sdk/src/sessions/changes.ts#L859-L870](../../../../packages/sdk/src/sessions/changes.ts#L859-L870) - `look`"
---

## Objective

A changeset row has `status: 1`, which is `Editing`, while an agent edits its file. The mark goes at the next read of the rows after the edit.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts` - keep the paths being edited per folder, set by `observe`, and put `status` on the rows.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the mark cases.

## Steps

1. Keep a set of the paths that an agent edits now, per folder, in the changes source.
2. Add the path at `observe` with `before`, and remove it at `after`.
3. At `before`, send the row of that file again with `status` `Editing`.
4. Put `status: 1` on a row from `rowsOf` or `look` whose path is in the set.
5. At a turn's end, empty the set of its folder.
6. Add cases: a row is `Editing` between `before` and `after`, and is not after the next read.

## Validation

- `changes-refresh.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The source answers `editing(path)` and `editsEnded(session, turnId)`. The host says the mark through `editingMoved`. The cases are in `changes-editing.test.ts`.
