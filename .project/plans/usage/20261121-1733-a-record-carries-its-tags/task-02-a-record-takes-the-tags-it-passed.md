---
title: A usage record takes the tags of what it passed through
status: done
depends: [task-01-agents-and-connectors-hold-tags.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L37-L80](../../../../packages/sdk/src/types/usage.ts#L37-L80) - `UsageBase`, which gets `tags`"
  - "[code://packages/sdk/src/usage/meter.ts#L105-L115](../../../../packages/sdk/src/usage/meter.ts#L105-L115) - how `ahpd.cost` is read off a report"
  - "[code://packages/sdk/src/usage/meter.ts#L248-L282](../../../../packages/sdk/src/usage/meter.ts#L248-L282) - `write`, which adds `tags`"
  - "[code://packages/sdk/src/host/spawn.ts#L1211-L1226](../../../../packages/sdk/src/host/spawn.ts#L1211-L1226) - the meter options, which get `tagsOf`"
  - "[code://packages/server/src/proxy/listener.ts#L1187-L1216](../../../../packages/server/src/proxy/listener.ts#L1187-L1216) - the proxy record, which adds `tags`"
  - "[code://packages/sdk/src/usage/usage.ts#L328-L360](../../../../packages/sdk/src/usage/usage.ts#L328-L360) - the line reader, which keeps `tags`"
---

## Objective

Each agent turn's record carries the agent's tags and the tags of each connector its report names.
Each proxy call's record carries the serving connector's tags.
A record with no tag has no `tags` field.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:37-80` - add `tags?: string[]` to `UsageBase`.
- `UPDATE: packages/sdk/src/usage/meter.ts:248-282` - add the `tagsOf(turn, connectors)` option and write `tags`.
- `UPDATE: packages/sdk/src/host/spawn.ts:1211-1226` - give the meter `tagsOf`, from the agent view and the connector records.
- `UPDATE: packages/server/src/proxy/listener.ts:1187-1216` - write the serving connector's tags.
- `UPDATE: packages/sdk/src/usage/usage.ts:328-360` - keep `tags` when a line is read, through `tagsOf`.
- `UPDATE: packages/sdk/test/usage-meter.test.ts` - the agent and connector cases.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - the proxy case.
- `UPDATE: .project/specs/usage.md` - add `tags` and where each tag comes from.

## Steps

1. Add `tags` to `UsageBase`, with a comment that says what it holds.
2. In the meter, read `_meta['ahpd.connectors']` off each report as a list of connector ids, as it reads `ahpd.cost`.
3. Keep the connector ids of all reports of a turn, each once.
4. Add the `tagsOf(turn, connectors)` option to `MeterOptions`.
5. In `write`, call `tagsOf` and set `tags` when the list is not empty.
6. In spawn, make `tagsOf` return the agent view's tags, then each connector's tags in order, each tag once.
7. Read the agent view and the connector records inside each `tagsOf` call, not when spawn makes the meter.
8. Leave out a connector id that has no record.
9. In the proxy listener, add the serving connector's tags to the record.
10. In the store's line reader, keep `tags` through `tagsOf`.
11. Add a test: two agent records with different tags write records with their own tags.
12. Add a test: a report that names two connectors with a shared tag writes that tag once.
13. Add a test: an edit to a tag after a turn ended changes no record already written.
14. Add a test: a proxy call writes its connector's tags.
15. Correct `.project/specs/usage.md`.

## Validation

- The tests of steps 11 to 14 are in `usage-meter.test.ts` and `proxy-policy-usage.test.ts`.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/server test` pass.
- The computer suite passes, because it writes `ComputerTime` through the same store.

## Resume

Built 2026-11-21.
The host takes `HostOptions.usageTags`, with `agent(id)` and `connector(id)`, and `run.ts` fills it from the two channels.
The proxy takes `ProxyOptions.connectorTags(id)` in the same way.
The meter joins the connectors of every report of a turn, so a failed-over turn keeps both logins.
