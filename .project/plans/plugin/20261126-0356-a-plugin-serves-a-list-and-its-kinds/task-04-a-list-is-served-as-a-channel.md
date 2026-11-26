---
title: A list is served as a channel
status: done
depends: ["task-01-a-kinds-operations-are-built-once.md", "task-03-the-fold-joins-a-lists-declarations.md"]
layer: "sdk lists"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L340-L390](../../../../packages/sdk/src/types/plugin.ts#L340-L390) - `PluginChannel`, which the list channel is"
  - "[code://packages/sdk/src/kinds/operations.ts#L318-L357](../../../../packages/sdk/src/kinds/operations.ts#L318-L357) - `pluginOperationChannels`, which serves the list channel's operations as it is"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L17](../../../../packages/sdk/src/resources/recordschannel.ts#L1-L17) - the `added`, `changed` and `removed` actions, sent as they are"
  - "[code://packages/sdk/src/host/snapshots.ts#L330-L337](../../../../packages/sdk/src/host/snapshots.ts#L330-L337) - the awaited snapshot of a plugin channel"
  - "[code://packages/sdk/src/tunnels/channel.ts#L462-L490](../../../../packages/sdk/src/tunnels/channel.ts#L462-L490) - `begin` and `settle`, the operation status the list channel copies"
---

## Objective

Each folded list is one `ServedChannel` in `options.channels`, and its row scheme is one resource provider.
The host asks the kinds for every row and keeps none.

## Files

- `CREATE: packages/sdk/src/lists/channel.ts` - `listChannel(list)`, a `PluginChannel` with its `operations` side, and the row resource provider.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - put each folded list's channel in `channels` and its provider in `resourceProviders`.
- `UPDATE: packages/sdk/src/index.ts` - export `listChannel`.
- `CREATE: packages/sdk/test/list-channel.test.ts` - the channel cases with a todo kind and a second kind.

## Steps

1. Parse the channel URI's query, and refuse a filter, a sort or a search the list does not declare.
2. Leave out a kind whose schema lacks a set filter's field.
3. Leave out a kind whose field has another type, by the brief's mapping.
4. Leave out a kind whose schema lacks the field of the asked sort.
5. Ask `rows.list(query, undefined, reader)` of each kind left in, at once.
6. Leave out a kind that throws, and push a problem on its plugin's row.
7. Merge the answers in the sort the query names, or in `defaultSort`.
8. Add `kind` and `operations` to each row, with `kindOffers` from task 01.
9. Answer the snapshot as `{ records, operations }`, the operations from `kindOperations` with `subject` and `scope` the list's `name`.
10. Serve the `operations` side: `run` checks the input against the kind's schema for create and update.
11. Hand create, update, remove and the kind's own operations to the kind's `invoke`, with the row read by `rows.read`.
12. Keep each operation's status with `begin` and `settle`, as the tunnels channel does, and publish `<scheme>/operations`.
13. Make the handle's `changed(instance, id)` call `rows.read` and publish `<scheme>/added`, `<scheme>/changed` or `<scheme>/removed`.
14. Serve `<name>://<id>` as a resource provider whose read asks the kind that answers the row.
15. Check `<name>:get` on subscribe and read, as a records channel checks its grant.

## Validation

- `packages/sdk/test/list-channel.test.ts` subscribes to `x-ahpd-todos://`, and the snapshot holds the rows of both kinds.
- With `?done=true`, the snapshot has no row of the kind with no `done` field.
- The host refuses `?colour=red`.
- `todo/create`, `todo/complete` and `todo/remove` reach the kind's `invoke`, and each subscriber gets the action after `changed`.
- The host refuses a create whose input breaks the schema, and `invoke` gets no call.
- When one kind throws in `rows.list`, the snapshot holds the other kind's rows.
- `resourceRead` of `todo://<id>` answers the row.
- The host refuses that read to a reader without `todo:get`.
- `npx vitest run packages/sdk/test/list-channel.test.ts packages/sdk/test/plugin-channel-operations.test.ts` passes.

## Resume

Built on 2026-11-26.
- Step 10: `x-ahpd/invokeOperation` already checks the input against the operation's schema, so `run` does not check it again.
- Step 6: a kind that throws raises a warning on its plugin's row through the plugin host's `problem`.
- A `changed` reads the row with no reader: with no instances, the channel's grant decides who reads, as the brief says.
- A kind that lacks the field of `defaultSort` keeps its rows, which go last. Only a sort the query names leaves a kind out.
- The operations are sent in English. A list has no catalogs yet.
