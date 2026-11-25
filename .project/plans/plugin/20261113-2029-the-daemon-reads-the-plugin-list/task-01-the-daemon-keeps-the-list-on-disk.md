---
title: The daemon keeps the list on disk
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/update.ts#L135-L144](../../../../packages/server/src/update.ts#L135-L144) - `refreshUpdate`, the request and the file this copies"
  - "[code://packages/server/src/update.ts#L94-L104](../../../../packages/server/src/update.ts#L94-L104) - `askRegistry`, whose 5000 ms timeout the fetch copies"
  - "[code://packages/server/src/update.ts#L155-L156](../../../../packages/server/src/update.ts#L155-L156) - `checkingUpdates`, the `CI` rule the fetch copies"
  - "[code://packages/server/src/commands/run.ts#L2380-L2384](../../../../packages/server/src/commands/run.ts#L2380-L2384) - the timer this copies"
  - "[code://packages/server/src/commands/options.ts#L1008-L1013](../../../../packages/server/src/commands/options.ts#L1008-L1013) - `updateCheck`, the field shape of the new settings"
  - "[code://packages/server/src/commands/options.ts#L1017](../../../../packages/server/src/commands/options.ts#L1017) - `FILE_ONLY`, which the new settings stay out of, so each one has a flag"
  - "[code://packages/server/src/commands/configure.ts#L339-L367](../../../../packages/server/src/commands/configure.ts#L339-L367) - `ask`, which the new question uses"
  - "[code://packages/server/test/cli.ts#L161-L172](../../../../packages/server/test/cli.ts#L161-L172) - `daemonEnv`, which sets `CI=1` for every spawned test daemon"
---

## Objective

`pluginMarketplaces` names the marketplace URLs in order, and `pluginCheckHours` the period.
A marketplace is a URL that serves a plugin list in the format of `plugins.ahpio.com/v1/plugins.json`.
The daemon fetches each list when its file is older than the period, and keeps each one in `plugin-marketplaces/`.
Under `CI`, the daemon fetches nothing.

## Files

- `CREATE: packages/server/src/pluginlist.ts` - the list's types, `readMarketplaces`, `refreshMarketplace` and `listedVersions`.
- `CREATE: packages/server/test/pluginlist.test.ts` - the fetch, the 304, a failure, a body over the size limit and a file that does not parse.
- `UPDATE: packages/server/src/config.ts:653` - `pluginMarketplaces` and `pluginCheckHours` in the configuration type.
- `UPDATE: packages/server/src/config.ts:966` - `pluginMarketplacesPath`, the folder `plugin-marketplaces/` beside `update.json`.
- `UPDATE: packages/server/src/commands/options.ts:1008-1013` - the two fields, with their defaults.
- `UPDATE: packages/server/src/commands/run.ts:2380-2384` - the fetch at start and the timer.
- `UPDATE: packages/server/src/commands/configure.ts:339-367` - the question for `pluginMarketplaces`.

## Steps

1. Add `pluginMarketplaces`, an array of URLs, `["https://plugins.ahpio.com/v1/plugins.json"]` by default, where `[]` turns the marketplaces off.
2. Add `pluginCheckHours`, a number, 12 by default, with no question in `ahpd configure`.
3. Keep both fields out of `FILE_ONLY`, so each one has a flag, as `updateCheck` has.
4. Write the types of the served file: `version`, `plugins`, each plugin's fields, and each version's fields.
5. Write `refreshMarketplace({ url, version, fetch })`, a GET with `User-Agent: ahpd/<version>` and `If-None-Match` from that list's file.
6. Give the GET a timeout of 5000 ms, as `askRegistry` has, and refuse a body larger than 5 MB.
7. Name each list's file by the first 16 hex digits of its URL's SHA-256, and keep the URL in it.
8. On 200, check `version` is 1 and `plugins` is an array, then write the body, the `ETag` and `checkedAt`.
9. On 304, write only `checkedAt`.
10. Leave the file as it was on any failure, and log one line at debug level.
11. Write `readMarketplaces()`, which answers the lists in `pluginMarketplaces` order, each with its URL, `checkedAt` and plugins, or `missing`.
12. Keep every entry of every list, two entries with the same id included.
13. Give each entry `marketplace`, the URL it came from.
14. In `run.ts`, fetch each list older than the period, then set a timer of the period with `unref`.
15. Fetch nothing when the environment has `CI`, as `checkingUpdates` does for the npm check.
16. In `ahpd configure`, ask `Plugin marketplaces` as URLs split by commas, with the current value, where an empty answer turns them off.
17. Remove the file of a list that `pluginMarketplaces` no longer names.

## Validation

- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server/test/pluginlist.test.ts` passes.
- Its cases are 200, 304, 500, a body that is not JSON, a body over 5 MB, and `version: 2`.
- `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` passes.
- A daemon with an isolated `XDG_CONFIG_HOME` and no `CI` writes one file in `plugin-marketplaces/`.
- A second start within 12 hours makes no request.
- A daemon with `CI=1` makes no request.
- Two stubbed marketplaces with the same id answer two entries, each with `marketplace` set to its URL.

## Resume

Built on 2026-11-15; awaits review.
`pluginlist.ts` holds the fetch, the files and the reads. `run.ts` calls `refreshMarketplaces` at start and on a timer of the period, capped at 2^31 - 1 ms. A new list refreshes the plugin channel. Under `CI` it fetches nothing.
The flags are `--plugin-marketplace <url>`, which repeats, and `--plugin-check-hours`.
`ahpd configure` asks `Plugin marketplaces` last, after the folders, since the configure cases answer by position. `ask` cannot answer with nothing, so `none` reads no list, in place of the empty answer of step 16. Enter keeps the default unwritten.
`pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` cannot find `@ahpd/sdk` in a fresh worktree, so `pnpm typecheck` at the root was run, and passes.
`pluginlist.test.ts` passes 36 cases. A test daemon from the branch ran on port 39200. Its start wrote one file in `plugin-marketplaces/`, and a restart left its `checkedAt` as it was. A start with `CI=1` wrote none.
