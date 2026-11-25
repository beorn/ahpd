---
title: A usage record carries the tags of what it passed through - implemented
date: 2026-11-21
refs:
  - git://usage/20261121-1733-a-record-carries-its-tags
  - "[code://packages/sdk/src/utils/tags.ts](../../../../packages/sdk/src/utils/tags.ts)"
  - "[code://packages/sdk/src/usage/meter.ts](../../../../packages/sdk/src/usage/meter.ts)"
  - "[code://packages/sdk/src/usage/usage.ts](../../../../packages/sdk/src/usage/usage.ts)"
  - "[code://packages/agent-claude/src/session/parts.ts](../../../../packages/agent-claude/src/session/parts.ts)"
---

An agent record and a connector now hold a list of tags.
Each usage record carries the tags of the agent and of each connector its work passed through, each tag once.
`usage://groups` groups and filters the records by tag.

## What was built

- [`code://packages/sdk/src/utils/tags.ts`](../../../../packages/sdk/src/utils/tags.ts) - `tagsOf`, `tagsProblem` and `joinTags`.
- [`code://packages/sdk/src/agents/channel.ts`](../../../../packages/sdk/src/agents/channel.ts) and [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - `tags` on the put, the row, the view and the reference.
- [`code://packages/sdk/src/usage/meter.ts`](../../../../packages/sdk/src/usage/meter.ts) - `ahpd.connectors` read off each report, and `tags` on the record.
- [`code://packages/server/src/proxy/listener.ts`](../../../../packages/server/src/proxy/listener.ts) - the serving connector's tags on a gateway call.
- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - each run names its login in `ahpd.connectors`.
- [`code://packages/sdk/src/usage/usage.ts`](../../../../packages/sdk/src/usage/usage.ts) - `by=tag` and the `tag` filter.
- `docs/sdk/USAGE.md`, `docs/sdk/AHP.md` and `.project/specs/usage.md` - the field, the key and the reads.

## Verified

- The sdk suite passes, 5158 tests, with `tools/schema.mjs` run first.
- The server suite passes, 2006 tests. The agent-claude suite passes, 698 tests. The computer suite passes, 633 tests.
- `pnpm typecheck` passes.

## Departures from the plan

- `AgentView.tags` is optional, because test fixtures and plugin tests build a view by hand.
- The host takes `HostOptions.usageTags` and the proxy `ProxyOptions.connectorTags`, which `run.ts` fills from the two channels.
- A Claude run names only its own login, and the meter and `mergeLogicalTurnUsage` join the runs of a failed-over turn.
- The branch stacks on the cost plan's branch, because both change the list `createParts` returns in `parts.ts`.

## Left for later

- No client shows or edits a tag yet. The channels send `tags` on each row.
