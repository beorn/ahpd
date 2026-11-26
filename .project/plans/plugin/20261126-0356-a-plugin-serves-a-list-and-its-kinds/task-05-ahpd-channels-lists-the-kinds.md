---
title: ahpd.channels lists the kinds
status: done
depends: ["task-04-a-list-is-served-as-a-channel.md"]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/root.ts#L659-L671](../../../../packages/sdk/src/host/root.ts#L659-L671) - `advertisedChannels`, which gets `kinds`"
  - "[code://packages/sdk/src/types/plugin.ts#L340-L390](../../../../packages/sdk/src/types/plugin.ts#L340-L390) - `PluginChannel`, which gets an optional `kinds`"
  - "[code://packages/sdk/test/plugin-channel.test.ts](../../../../packages/sdk/test/plugin-channel.test.ts) - the handshake tests this task's cases join"
---

## Objective

The `ahpd.channels` entry of a list has `kinds`, one entry per kind with its title, description, schema and every operation in full.
A todo plugin and a second plugin's kind work end to end through `createHost`.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:340-390` - an optional `kinds()` on `PluginChannel`.
- `UPDATE: packages/sdk/src/lists/channel.ts` - answer `kinds()` from the list's kinds and `kindOperations`.
- `UPDATE: packages/sdk/src/host/root.ts:659-671` - add `kinds` to an entry whose channel answers it.
- `CREATE: packages/sdk/test/lists.test.ts` - the end-to-end cases through `createHost`.

## Steps

1. Add `kinds?(): Record<string, unknown>` to `PluginChannel`, read when the host advertises the channel.
2. Answer it in the list channel with each kind's `title`, `description`, `schema` and operations.
3. Add `kinds` to the `advertisedChannels` entry when the channel answers it.
4. Check the root state changes when a plugin with a kind loads and unloads.
5. Write the end-to-end test with two fixture plugins through `createHost`.

## Validation

- `packages/sdk/test/lists.test.ts` reads `ahpd.channels` and finds `x-ahpd-todos` with both kinds and every operation, as the todo brief's example has them.
- It subscribes, creates, completes and removes a todo through `x-ahpd/invokeOperation`, and a second client gets each action.
- It unloads the second plugin, and the entry and the snapshot lose its kind.
- `npm test` in `packages/sdk` passes, and `npm run build` passes.

## Resume

Built on 2026-11-26. The end-to-end test serves `x-ahpd/invokeOperation` as a base method, as the daemon does.
