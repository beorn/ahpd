---
title: The daemon reads the plugin list - implemented
date: 2026-11-15
refs:
  - git://a01d874cb
  - "[code://packages/server/src/pluginlist.ts](../../../../packages/server/src/pluginlist.ts) - the lists, kept on disk"
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - an install from a list"
---

The daemon reads the plugin lists of its marketplaces, keeps them on disk and serves them to clients. An install of a listed plugin takes the newest listed version that fits the daemon. PR #339 merged it on 2026-11-15.

## What was built

- [`code://packages/server/src/pluginlist.ts`](../../../../packages/server/src/pluginlist.ts) - reads the lists in `pluginMarketplaces`, by default `https://plugins.ahpio.com/v1/plugins.json`. It checks them every `pluginCheckHours` and keeps them under `plugin-marketplaces/`, and fetches nothing under `CI`.
- [`code://packages/server/src/pluginschannel.ts`](../../../../packages/server/src/pluginschannel.ts) - `x-ahpd/plugins/available` lists each listed plugin with its marketplace, versions, icons and whether it is installed. `x-ahpd/plugins/details` answers a listed version's README, changelog, license and manifest, kept under `plugin-files/`.
- [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts) - `install` takes a `marketplace`, checks the npm integrity against the list, and records the source in `installed.json`. `remove` gives npm the package name, and every `npm uninstall` runs with `--legacy-peer-deps`.
- [`code://packages/server/src/commands/plugin.ts`](../../../../packages/server/src/commands/plugin.ts) - `ahpd plugin available`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the marketplaces.

## Verified

- The server suite passed 1936 cases, 3 skipped.
- A test daemon read the live list.

## Departures from the plan

- None recorded.

## Left for later

- The auto-update, the held-back version, the update of a `github:` source and the install progress are later plans, as the plan's *Goal* says.
