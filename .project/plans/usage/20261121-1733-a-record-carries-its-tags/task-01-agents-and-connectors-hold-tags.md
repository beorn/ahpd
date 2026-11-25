---
title: An agent record and a connector hold tags
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agents.ts#L53-L108](../../../../packages/sdk/src/types/agents.ts#L53-L108) - `AgentRecord` and `AgentView`"
  - "[code://packages/sdk/src/types/connectors.ts#L218-L229](../../../../packages/sdk/src/types/connectors.ts#L218-L229) - `Connector`"
  - "[code://packages/sdk/src/agents/channel.ts#L470-L500](../../../../packages/sdk/src/agents/channel.ts#L470-L500) - the `description` and `icon` reads to copy"
  - "[code://packages/sdk/src/agents/channel.ts#L791-L810](../../../../packages/sdk/src/agents/channel.ts#L791-L810) - the field checks of the update command"
  - "[code://packages/sdk/src/connectors/channel.ts#L353-L362](../../../../packages/sdk/src/connectors/channel.ts#L353-L362) - the `title` read to copy"
  - "[code://packages/sdk/src/connectors/channel.ts#L895-L900](../../../../packages/sdk/src/connectors/channel.ts#L895-L900) - the `title` check of the update command"
---

## Objective

An agent record and a connector record keep `tags`, a list of strings.
The channels read, check, save and send them, and a live view has them at each call.

## Files

- `UPDATE: packages/sdk/src/types/agents.ts:53-108` - add `tags?: string[]` to `AgentRecord` and `readonly tags: string[]` to `AgentView`.
- `UPDATE: packages/sdk/src/types/connectors.ts:218-229` - add `tags?: string[]` to `Connector` and to `ConnectorRef`.
- `CREATE: packages/sdk/src/utils/tags.ts` - `tagsOf(value)`, which reads a list, and `checkTags(value)`, which says why a list is refused.
- `UPDATE: packages/sdk/src/agents/channel.ts` - read, check, save and send `tags`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - read, check, save and send `tags`.
- `CREATE: packages/sdk/test/tags.test.ts` - the reader and the check.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - an agent's tags are saved and read back.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - a connector's tags are saved and read back.

## Steps

1. Write `tagsOf` to keep each string of a list once, in order, and to drop what is not a string.
2. Write `checkTags` to refuse a tag that is empty, longer than 64, or holds a comma or a control character.
3. Make `checkTags` refuse a list of more than 32 tags.
4. Add `tags` to `AgentRecord`, `AgentView`, `Connector` and `ConnectorRef`.
5. In the agents channel, read `tags` with `tagsOf` where it reads `description`.
6. In the agents channel, refresh `view.tags` where it refreshes `view.description`.
7. In the agents channel's update command, check `tags` with `checkTags` and save the list.
8. In the connectors channel, read, check and save `tags` where it handles `title`.
9. Send `tags` in each listing and answer that sends `description` or `title` today.
10. Add the tests.

## Validation

- `packages/sdk/test/tags.test.ts` holds: a repeat kept once, a non-string dropped, a comma refused, 33 tags refused.
- The channel tests show a saved list read back, and a record with no `tags` read as an empty list.
- `pnpm --filter @ahpd/sdk test` and `pnpm typecheck` pass.

## Resume

Built 2026-11-21.
The helpers are `tagsOf`, `tagsProblem` and `joinTags` in `packages/sdk/src/utils/tags.ts`, so `checkTags` is named `tagsProblem`.
`AgentView.tags` is optional, because about twenty test fixtures and any plugin test build a view by hand.
The channel's own view always holds a list, and `AgentsChannel.tagsOf(id)` reads it.
