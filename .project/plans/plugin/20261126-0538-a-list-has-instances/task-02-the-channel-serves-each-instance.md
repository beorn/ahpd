---
title: The channel serves each instance
status: todo
depends: 
  - task-01-an-instance-comes-and-goes.md
layer: "sdk"
---

## Objective

The list channel asks each instance of each kind, names each row by its instance, and shows a reader only the rows they may read.

## Files

- `UPDATE: packages/sdk/src/lists/channel.ts` - instances in the query, the rows, the reads, `changed`, the operations' target and the snapshot.
- `CREATE: packages/sdk/test/list-instances.test.ts` - the cases.
- `UPDATE: docs/plugins/PLUGINS.md` - the section "A list of your own".
- `UPDATE: docs/updates/v0_16.md` - the SDK line.

## Steps

1. Ask `rows.list(query, instance, reader)` once for each instance of each kind that takes part.
2. Add `instance` to each row, and serve `<name>://<instance>/<id>` as its URI.
3. Leave out the rows of an instance whose owner the reader may not read, by `ownerAllows`.
4. Take `instance` as a query filter with several values.
5. Read `target.id` as `<instance>/<id>`, and hand the kind the row with its instance.
6. Make `changed(instance, id)` read that instance's row, and test it for each watched URI and its readers.
7. List the instances in the snapshot, and send `<scheme>/instances` when one comes or goes.
8. Send `added` for each row of an instance that came, and `removed` for each row of one that went.
9. Write the docs and the release line.

## Validation

- Two instances with the same row id give two rows with two URIs.
- A reader on another team does not see the rows of a team's instance.
- `todo/complete` with `target.id` `prod/t-1` reaches the kind with instance `prod`.
- A removed instance sends `removed` for each of its rows.

## Resume
