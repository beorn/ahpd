---
title: The host runs a runtime row
status: todo
depends: 
  - task-01-a-kind-is-runtime.md
layer: "sdk"
---

## Objective

The list channel serves start and stop, keeps the live fields, and stops every running row at close.

## Files

- `UPDATE: packages/sdk/src/lists/channel.ts` - start and stop operations, the live fields and the close.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the close of a list with runtime kinds.
- `CREATE: packages/sdk/test/list-runtime.test.ts` - the cases.
- `UPDATE: docs/plugins/PLUGINS.md` - the section "A list of your own".
- `UPDATE: docs/updates/v0_16.md` - the SDK line.

## Steps

1. List `<kind>/start` and `<kind>/stop` for a runtime kind.
2. Offer `start` when the row is not running, and `stop` when it is.
3. Run `start` in a process, and set the row's `process` to its URI.
4. Add the process's live state to the row, and send `changed` for each report.
5. Refuse a create or update that writes a live field.
6. Call `stop` on each running row when the host closes.
7. Write the docs and the release line.

## Validation

- `start` runs the kind's hook, and each report reaches the subscribers.
- Nothing starts at listening.
- A close stops each running row.

## Resume
