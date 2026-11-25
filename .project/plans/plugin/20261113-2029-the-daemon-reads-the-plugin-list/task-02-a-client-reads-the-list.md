---
title: A client reads the list
status: done
depends: [task-01-the-daemon-keeps-the-list-on-disk.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L86-L100](../../../../packages/server/src/commands/plugin.ts#L86-L100) - `plugin.list`, the action shape this copies"
  - "[code://packages/server/src/pluginschannel.ts#L878-L889](../../../../packages/server/src/pluginschannel.ts#L878-L889) - where the new command joins the others"
  - "[code://packages/server/src/pluginschannel.ts#L306-L343](../../../../packages/server/src/pluginschannel.ts#L306-L343) - a row's id by `pluginIdOf(spec, where)`, and its alerts, which get the deprecation"
  - "[code://packages/server/src/plugins.ts#L137-L138](../../../../packages/server/src/plugins.ts#L137-L138) - `pluginIdOf`, which with no `where` answers the spec and not the id"
  - "[code://packages/server/src/icons.ts#L333](../../../../packages/server/src/icons.ts#L333) - `fetchIcons`, which turns each icon into a `data:` URI"
---

## Objective

`ahpd plugin available`, `GET /plugin/available` and `x-ahpd/plugins/available` answer the listed plugins of every marketplace.
Each entry names its marketplace, and says whether its id is installed, and at which version.
Each icon is a `data:` URI, so a client never contacts the host the list names.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts:86-100` - the action `plugin.available`.
- `UPDATE: packages/server/src/pluginschannel.ts:878-889` - the command `x-ahpd/plugins/available`.
- `UPDATE: packages/server/src/pluginschannel.ts:314` - the deprecation alert on the row of a plugin that runs a deprecated version.
- `UPDATE: packages/server/src/pluginlist.ts` - the icons, fetched once and kept on disk.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the command over a stubbed list.
- `UPDATE: docs/plugins/PLUGINS.md` - the command, its answer and its grant.

## Steps

1. Add `plugin.available` with the CLI pattern `plugin available`, `GET /plugin/available`, `effect: 'read'` and `plugin:list`.
2. Answer `{ marketplaces: [{ url, state: 'on' | 'missing', checkedAt? }], plugins }`; `missing` is no file yet, `[]` is off.
3. Give each entry the list's fields, `marketplace` and `versions`, plus `installed` with the installed version, or nothing.
4. Find `installed` by `pluginIdOf(spec, where)` over the configured plugins, as the row does. With no `where`, it answers the spec and not the id.
5. Add the marketplace from `installed.json` to `installed`, so a client knows which of two entries with one id it is.
6. Answer each plugin's `icons` through `fetchIcons`, with the daemon's icon bounds.
7. Keep each fetched icon at `plugin-files/icons/<first 16 hex digits of its URL's SHA-256>`, and read it from there the next time.
8. When the list marks the installed version `deprecated`, add its message to `installed`.
9. In the row at `pluginschannel.ts:314`, add one warning alert with `ref: 'deprecated'` and the message. Build it from the list file, and keep it out of the alert store.
10. Refresh the plugin channel after a fetch writes a new list, so the rows show a new deprecation.
11. In the terminal, print one line for each entry: id, newest version, marketplace, `installed <version>` and description.
12. Add `x-ahpd/plugins/available` with `plugin:list`, which answers the same object.
13. Document the command and its answer in `PLUGINS.md`.

## Validation

- The channel test answers two entries for a stubbed list, with one marked installed.
- The channel test answers two entries for one id in two stubbed marketplaces, each with its `marketplace`.
- An icon in the answer is a `data:` URI, and a second call makes no request for it.
- The row of a plugin that runs a stubbed deprecated version has the alert with `ref: 'deprecated'`.
- `ahpd plugin available` against a written list file prints both lines.
- `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` passes.

## Resume

Built on 2026-11-15; awaits review.
`plugin.available` and `x-ahpd/plugins/available` share `availableAnswer` in `commands/plugin.ts`.
An entry is installed when an installed package is its source, and else when an installed plugin has its id. A `github:` package is matched through `installed.json`. The list names `agent-acp` where ahpd names the installed plugin `ahpd-agent-acp`, so a match by id alone marked nothing.
The deprecation alert's `ref` is `deprecated:<version>`, as an alert's `ref` is `<kind>:<id>`.
`installed` also names the installed row's `id`, since the list's id need not be the row's.
ahpw's plan plugins/20261115-0746 reads that id to give an installed plugin its list tabs.
The channel suite passes 54 cases. Against the live list in a scratch home, `ahpd plugin available` printed 12 plugins, with agent-acp marked `installed 0.14.0`, and every icon as a `data:` URI.
