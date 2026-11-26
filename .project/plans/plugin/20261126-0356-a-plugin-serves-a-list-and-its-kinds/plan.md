---
title: A plugin serves a list and its kinds
domain: plugin
status: active
priority: high
created: 2026-11-25
revalidated: 2026-11-25
refs:
  - "[briefs/a-list-and-its-kinds.md](../../../briefs/a-list-and-its-kinds.md) - the shape this plan builds the first step of, as *Step 1* and *Step 2* say"
  - "[briefs/a-todo-app-is-the-first-agent-app.md](../../../briefs/a-todo-app-is-the-first-agent-app.md) - the wire this plan's test follows: the row, the snapshot, `ahpd.channels` with `kinds`, and `todo/create`"
  - git://09c4378bf - the brief's commit when this plan was written
  - "[code://packages/sdk/src/plugins/plugins.ts#L1818-L1853](../../../../packages/sdk/src/plugins/plugins.ts#L1818-L1853) - `registerChannel`, the registration `registerList` copies: the scheme check, the contract, and the handle that publishes"
  - "[code://packages/sdk/src/plugins/plugins.ts#L2133-L2143](../../../../packages/sdk/src/plugins/plugins.ts#L2133-L2143) - `registerTunnelKind`, the registration `registerKind` copies"
  - "[code://packages/sdk/src/plugins/plugins.ts#L537-L572](../../../../packages/sdk/src/plugins/plugins.ts#L537-L572) - the fold joins grants by subject and refuses a channel another plugin took, the two rules a list's join reuses"
  - "[code://packages/sdk/src/plugins/plugins.ts#L652-L671](../../../../packages/sdk/src/plugins/plugins.ts#L652-L671) - the fold of tunnel kinds, the one a list's kinds copy"
  - "[code://packages/sdk/src/plugins/validate.ts#L1058](../../../../packages/sdk/src/plugins/validate.ts#L1058) - `checkTunnelKind`, whose checks of the name, the schema and the operations a kind reuses"
  - "[code://packages/sdk/src/plugins/validate.ts#L503](../../../../packages/sdk/src/plugins/validate.ts#L503) - `listedOperations`, the check of the operations a channel lists"
  - "[code://packages/sdk/src/plugins/validate.ts#L351](../../../../packages/sdk/src/plugins/validate.ts#L351) - `declared`, the contract check every registration runs"
  - "[code://packages/sdk/src/types/plugin.ts#L340-L390](../../../../packages/sdk/src/types/plugin.ts#L340-L390) - `PluginChannel`, which a list's channel is, with its `operations` side"
  - "[code://packages/sdk/src/types/kinds.ts](../../../../packages/sdk/src/types/kinds.ts) - `KindOperation`, `ChannelOperation` and `Operation`, the operation types a kind uses as they are"
  - "[code://packages/sdk/src/tunnels/channel.ts#L196-L213](../../../../packages/sdk/src/tunnels/channel.ts#L196-L213) - `offersOf`, the operations one row offers, which task 01 shares"
  - "[code://packages/sdk/src/tunnels/channel.ts#L319-L383](../../../../packages/sdk/src/tunnels/channel.ts#L319-L383) - `operationsOf`, the create, update, remove and own operations of each kind, which task 01 shares"
  - "[code://packages/sdk/src/kinds/operations.ts#L318-L357](../../../../packages/sdk/src/kinds/operations.ts#L318-L357) - `pluginOperationChannels`, which already serves a plugin channel's operations to `x-ahpd/invokeOperation`"
  - "[code://packages/sdk/src/host/root.ts#L659-L671](../../../../packages/sdk/src/host/root.ts#L659-L671) - `advertisedChannels`, the `ahpd.channels` entry that gets `kinds`"
  - "[code://packages/sdk/src/host/snapshots.ts#L330-L337](../../../../packages/sdk/src/host/snapshots.ts#L330-L337) - a plugin channel's snapshot is awaited, so a list may ask its kinds"
  - "[code://packages/sdk/src/resources/recordschannel.ts#L1-L17](../../../../packages/sdk/src/resources/recordschannel.ts#L1-L17) - the `added`, `changed` and `removed` actions a list's channel sends as they are"
  - "[code://packages/server/src/channeloperations.ts](../../../../packages/server/src/channeloperations.ts) - the daemon serves the operations of every folded channel, so a list's reach the command with no server change"
  - "[code://packages/sdk/test/plugin-channel.test.ts](../../../../packages/sdk/test/plugin-channel.test.ts) - the tests of a plugin channel, the pattern the list tests follow"
  - "[code://packages/sdk/test/tunnels-channel.test.ts](../../../../packages/sdk/test/tunnels-channel.test.ts) - the tunnel tests that guard task 01's shared code"
---

## Goal

A plugin declares a list with `registerList`, and any plugin adds kinds to it with `registerKind`.
The host keeps the list's structure: its declaration, its kinds, its filters and its sorts.
The kinds keep the rows, and the host asks them for each snapshot and each read.
A client subscribes to the list's channel, reads one row by its URI, and runs its operations with `x-ahpd/invokeOperation`.
This is step 1 of the brief: a list with no instances and no paging.
A todo plugin and a second plugin's kind in the same list test it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "registerList|registerKind" packages` - nothing in code; only the briefs and an idea name them.
- `rg "registerChannel|registerTunnelKind" packages/sdk/src` - one registration each in `plugins/plugins.ts`, and one fold each.
- `rg "ahpd.channels" packages/sdk/src` - `host/root.ts` and `host/handshake.ts` build it from `options.channels`, with no `kinds`.
- `rg "tunnelsChannel\(" packages` - the tunnels channel is built in the server, in `commands/run.ts`, and is not touched here.

### Runtime path

```
plugin apply -> registerList, registerKind -> fold joins lists, attaches kinds
  -> one ServedChannel in options.channels, one resource provider per row scheme, the list's grants
  -> subscribe x-ahpd-todos:// -> each kind's rows.list -> snapshot { records, operations }
  -> invokeOperation todo/complete -> pluginOperationChannels -> kind's invoke -> changed -> rows.read -> x-ahpd-todos/changed
  -> ahpd.channels entry with kinds -> a client draws the list
```

### Gaps

- `Not found: a channel that more than one plugin serves` - searched `channels[scheme]` in `plugins/plugins.ts`; the fold refuses a second plugin, so a list's channel is built by the fold, not registered by a plugin.
- `Not found: kinds in ahpd.channels` - searched `advertisedChannels` in `host/root.ts`.
- The operations of a kind are built inside `tunnels/channel.ts` only, so a list would copy them without task 01.

## Answers

| What | Source | Task |
| --- | --- | --- |
| This plan is step 1: the structure of a list, with rows the kinds answer | Softov, 2026-11-25: "ok, so into planning what would be first plan?" | 02 |
| The host keeps a list's structure, and the kinds of a list a plugin registers keep its rows | Softov, 2026-11-25: "the host keep the structure. Imagine 1M tickets and the host keeping it" | 04 |
| The host keeps the rows only of the channels it controls, such as tunnels, which stay as they are | Softov, 2026-11-25: "the host keep the rows for the channels it control. like tunnels" | - |
| `registerKind` has no `source` | Softov, 2026-11-25, chose "Drop source" | 02 |
| A kind joins a list by `channel` | Softov, 2026-11-25, chose `channel` | 02 |
| A list with `instances: true` is refused until instances are built | Softov, 2026-11-25, chose "Refuse it until step 3" | 02 |
| A list with `page` is refused until the merged cursor is built | Softov, 2026-11-25, chose "Refuse it until step 4" | 02 |
| A list is served by a new list channel, not by `RecordsChannel`, so the host holds no copy of the rows | Softov, 2026-11-25, chose "A new list channel" | 04 |
| Lists are served from `packages/sdk` | Softov, 2026-11-25, chose "packages/sdk" | 04 |
| Reuse what exists before defining a new structure | Softov, 2026-11-25: "Try to reuse the max possible things we could. to not redefine structure just because you can." | 01 |
| A list's channel is a `ServedChannel` in `options.channels`, so subscribe, the gate and `invokeOperation` serve it as they are | (defaulted: the reuse rule; `pluginOperationChannels` and the daemon's `channelOperations` already read `options.channels`) | 03 |
| One row is a resource provider on the list's `name`, so `resourceRead` serves `todo://<id>` as it is | (defaulted: the reuse rule; the brief's *What the host does*) | 04 |
| The operations of a kind are built by one shared function, which the tunnels channel uses too | (defaulted: the reuse rule; `operationsOf` and `offersOf` in `tunnels/channel.ts`) | 01 |
| A kind's operation ids are `<kind>/create`, `<kind>/update`, `<kind>/remove` and `<kind>/<id>` | the todo brief's `ahpd.channels` example | 01 |
| The grants are `<name>:get`, `<name>:put` and `<name>:delete`, joined into the fold's grants | the brief's *Step 1* | 03 |
| A second `registerList` with the same `name` joins the first: its filters join, and a different `channel` or text is a warning on its plugin's row | the brief's *Step 1*, and Softov, 2026-11-25: "Joined" | 03 |
| A list on a scheme a `registerChannel` took, or the other way round, is refused | Softov, 2026-11-25, chose "Refused" | 03 |
| Any plugin may name an `x-ahpd-*` scheme | Softov, 2026-11-25, chose "Any plugin" | 02 |
| Create, update, remove and the kind's own operations go to the kind's `invoke`, after the host checks the input against the schema | Softov, 2026-11-25, chose "Through invoke" | 04 |
| A kind says a row changed with `changed(instance, id)` on its handle, and the host reads it with `rows.read` and sends one action | Softov, 2026-11-25, chose "Handle method" | 04 |
| The host refuses a filter or a sort the list does not declare | the brief's *Step 1* | 04 |
| A kind takes part in a filter by the brief's fixed mapping; step 1 builds `enum` and `boolean` | Softov, 2026-11-25, chose "Fixed mapping" | 04 |
| A kind that lacks a filter's field, or cannot sort by the field asked, has its rows left out while it is set | Softov, 2026-11-25: "Left out", and chose "Left out" | 04 |
| The kind filters and sorts its own rows; the host merges the kinds' answers in the order asked | (defaulted: the kinds keep the rows, so only they can filter them) | 04 |
| A row is `{ id, kind, owner?, record, operations }`: the kind answers `id`, `owner` and `record`, and the host adds `kind` and `operations` | the todo brief's *The row* | 04 |
| A list kind's `invoke` takes `(operation, row, input)`, with no `report` | Softov, 2026-11-26, chose "No report: (operation, row, input)" | 02 |
| A create's `invoke` answers the id of the row it made, and the host answers the caller with that row | Softov, 2026-11-26, chose "invoke answers the id" | 04 |
| A kind with `class: 'runtime'` is refused until the step that builds its hooks | (defaulted: as `instances` and `page` are refused) | 02 |
| `relations` is checked and kept, and served by a later step | (defaulted: step 1 builds no `uri` filter) | 02 |
| `invoke` gets no row for an operation on the list as a whole, such as create | (defaulted: such an operation has no target) | 04 |
| A change reaches a subscriber of a filtered URI: the host reads the row once and tests it against each watched query, by the declared rules | Softov, 2026-11-26, chose "The host tests the row" | 04 |
| `ahpd.channels` lists each list with `kinds`, one entry per kind, each with every operation in full | the todo brief's *How a client finds the kind* | 05 |
| The tests are fixtures in `packages/sdk/test`: a todo plugin that keeps its rows in memory, and a second plugin that adds a kind | (defaulted: a real `@ahpd/todo` package is the todo brief's own plan) | 05 |

## Proposed architecture

- **Data flow** - the kinds hold the rows. The list channel asks `rows.list(query, undefined, reader)` of each kind that takes part, merges the answers, and adds `kind` and `operations` to each row.
- **Event flow** - an operation reaches the list channel's `operations.run` through `pluginOperationChannels`, which calls the kind's `invoke`. `changed(id)` on the kind's handle reads the row and publishes `<scheme>/added`, `<scheme>/changed` or `<scheme>/removed`.
- **State flow** - the host holds the joined declaration, the kinds, and each operation's status while it runs, as the tunnels channel does. It holds no row.
- **Layer responsibilities** - `packages/sdk/src/plugins`: the registrations, their checks and the fold · `packages/sdk/src/lists`: the list channel and the row provider · `packages/sdk/src/kinds`: a kind's operations · `packages/sdk/src/host`: `ahpd.channels`.
- **Source-of-truth files** - `packages/sdk/src/types/lists.ts` for the declarations, which task 02 creates, and [`code://packages/sdk/src/types/kinds.ts`](../../../../packages/sdk/src/types/kinds.ts) for the operations.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-kinds-operations-are-built-once](task-01-a-kinds-operations-are-built-once.md) | done | - |
| [02 - a-plugin-declares-a-list-and-kinds](task-02-a-plugin-declares-a-list-and-kinds.md) | done | - |
| [03 - the-fold-joins-a-lists-declarations](task-03-the-fold-joins-a-lists-declarations.md) | done | 02 |
| [04 - a-list-is-served-as-a-channel](task-04-a-list-is-served-as-a-channel.md) | done | 01, 03 |
| [05 - ahpd-channels-lists-the-kinds](task-05-ahpd-channels-lists-the-kinds.md) | done | 04 |

## Risks and tradeoffs

- A kind that answers slowly holds a whole snapshot - the list asks every kind at once.
- A kind that throws stops a snapshot - its rows are left out, with a warning on its plugin's row.
- Task 01 changes the tunnels channel - the tunnel tests run unchanged, and the shared function keeps `enable` and `disable` as the tunnels channel's own additions.
- With no `page`, a large list is sent whole - a list with `page` is refused until the cursor exists.

## Resume state

- **Done so far:** all five tasks, on 2026-11-26. [implemented.md](implemented.md) holds the checks and the departures.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** the host keeps no row of a plugin's list; do not reach for `RecordsChannel` or a record collection. The tunnels channel stays in the server and keeps its rows.

## Final verification checklist

- [x] A todo plugin's list subscribes, creates, completes and removes a todo, and every subscriber gets each action.
- [x] A second plugin's kind shows its rows in the same snapshot.
- [x] A filter on a field that kind lacks leaves its rows out.
- [x] `resourceRead` of `todo://<id>` answers the row.
- [x] `ahpd.channels` lists the list with both kinds and every operation.
- [x] A list with `instances: true` or `page` is refused, and so is a list on a `registerChannel` scheme.
- [x] The tunnel tests pass unchanged.
- [x] `npm test` in `packages/sdk` passes, and `npm run build` passes.
