---
title: The list serves added operations
status: todo
depends: 
  - task-01-a-plugin-registers-an-operation.md
layer: "sdk"
---

## Objective

The fold attaches each added operation to its kinds or its list, and the list channel lists it and runs it.

## Files

- `UPDATE: packages/sdk/src/plugins/plugins.ts` - attach each added operation, and report a clash.
- `UPDATE: packages/sdk/src/kinds/operations.ts` - `kindOperations` and `kindOffers` take the added operations.
- `UPDATE: packages/sdk/src/lists/channel.ts` - list and run them.
- `CREATE: packages/sdk/test/list-added-operations.test.ts` - the deploy, link and export cases.
- `UPDATE: docs/plugins/PLUGINS.md` - the section "A list of your own".
- `UPDATE: docs/updates/v0_16.md` - the SDK line.

## Steps

1. Attach each operation with `kinds` to each named kind of the list.
2. Attach each operation with no `kinds` to the list, as `<plugin>/<operation>` with `list` scope.
3. Report an id that clashes, and keep the first.
4. List the added operations beside the kind's own, with the adding plugin's grant and words.
5. Offer each one on a row by its `offered`.
6. Run each one with the adding plugin's `invoke`.
7. Write the docs and the release line.

## Validation

- The list shows a deploy onto two kinds as two ids.
- Each id runs the deploy plugin's `invoke`.
- `offered` hides it on a row without a deploy declaration.
- An export on the list runs with no target.
- An id that clashes is a problem line, and the kind's own stays.

## Resume
