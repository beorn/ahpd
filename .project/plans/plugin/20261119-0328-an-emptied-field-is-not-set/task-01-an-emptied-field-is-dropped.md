---
title: An emptied optional field is dropped before the check
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/kinds/operations.ts#L182-L198](../../../../packages/sdk/src/kinds/operations.ts#L182-L198) - `inputOf`"
---

## Objective

An operation's input leaves out each optional top-level field that is `""` and that its schema refuses as `""`.

## Files

- `UPDATE: packages/sdk/src/kinds/operations.ts:182-198` - `inputOf` drops such a field before it checks the input.
- `UPDATE: packages/sdk/test/kinds-operations.test.ts` - the cases of an emptied field.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. In `inputOf`, read the schema's `properties` and `required`.
2. For each optional field that is `""` and not `secret`, check `""` against its schema with `check`.
3. Leave out each field whose check refuses `""`.
4. Check the rest of the input, and answer it to the channel.
5. Add a case: an update with `person: ""` on a field that takes `^user:.+$` runs, and the input has no `person`.
6. Add a case: a required field sent as `""` is still refused.
7. Add a case: an optional field whose schema takes `""` keeps it.
8. Add a case: a blank secret reaches the check unchanged.
9. Add a line to the unreleased notes.

## Validation

- The case of step 5 passes, and fails without step 3.
- The sdk suite and the server suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

