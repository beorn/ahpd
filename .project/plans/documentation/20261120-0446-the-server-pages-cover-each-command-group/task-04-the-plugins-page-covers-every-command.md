---
title: The plugins page covers every command
status: done
depends: []
layer: "docs"
refs:
  - "[code://packages/server/src/commands/plugin.ts](../../../../packages/server/src/commands/plugin.ts) - every `ahpd plugin` command"
  - "[code://docs/server/PLUGINS.md](../../../../docs/server/PLUGINS.md) - the page, without `available`, `apply` and `reload`"
---

## Objective

`docs/server/PLUGINS.md` has every `ahpd plugin` command, and says what the plugin lists are.

## Files

- `UPDATE: docs/server/PLUGINS.md` - `available`, `apply` and `reload`, and a section on the plugin lists.

## Steps

1. Add `plugin available`, which lists every entry of the lists `pluginMarketplaces` names, and which of them you installed.
2. Add a section on the plugin lists: `pluginMarketplaces`, `--plugin-marketplace` and `pluginCheckHours`.
3. Add `plugin apply`, which loads what the configuration now names, and say when it answers that you must restart.
4. Add `plugin reload`: import a plugin again after its code changed.

## Validation

- Every command `ahpd plugin --help` lists is on the page.
- Each new line matches the command's `--help`.
- `pnpm docs:build` passes.

## Resume

Written on 2026-11-20. The page also said a change loads at the next restart. A running daemon with the HTTP API loads it at once, so the sentence says so. The plugin table gained `@ahpd/tasks` and `@ahpd/activepieces`.

