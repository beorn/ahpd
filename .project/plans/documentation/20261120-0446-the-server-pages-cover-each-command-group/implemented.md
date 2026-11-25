---
title: The server pages cover each command group - implemented
date: 2026-11-20
refs:
  - git://0cb7bbb1f
  - "[code://docs/server/TEAMS.md](../../../../docs/server/TEAMS.md)"
  - "[code://docs/server/NODES.md](../../../../docs/server/NODES.md)"
  - "[code://docs/server/AUTOMATIONS.md](../../../../docs/server/AUTOMATIONS.md)"
---

A person who runs the daemon finds a server page for each `ahpd` command group. Teams and projects, joined nodes and automations have a page each, and the plugins page covers every plugin command and the plugin lists.

## What was built

- [`code://docs/server/TEAMS.md`](../../../../docs/server/TEAMS.md) - teams and projects, the six commands, memberships, and where a team is used.
- [`code://docs/server/NODES.md`](../../../../docs/server/NODES.md) - a hub and its nodes, `join` and the three `node` commands, the nodes file and the grants.
- [`code://docs/server/AUTOMATIONS.md`](../../../../docs/server/AUTOMATIONS.md) - `automation list`, `export` and `import`, the files, the settings and the HTTP routes.
- [`code://docs/server/PLUGINS.md`](../../../../docs/server/PLUGINS.md) - `plugin available`, `apply` and `reload`, and the plugin lists.
- [`code://packages/server/src/commands/nodes.ts`](../../../../packages/server/src/commands/nodes.ts) - `node rm`'s help says a running daemon drops the node at once.
- The three pages are in the Server sidebar group and the `server` table, after Users.

## Verified

- Each command line matches its `--help` and its code.
- `pnpm docs:build` passed, with no dead link. The server suite passed, 1982 cases.
- #391 passed `check` and `check-windows` on its first run, and merged as `0cb7bbb1f` on 2026-11-20.
- Softov read the pages on 2026-11-20: "the server pages are good".

## Departures from the plan

- The node commands, the nodes file and the grants moved from *Joined nodes* in `plugins/COMPUTERS.md` to `NODES.md`, so each fact is in one file.
- The `list` paragraph and its example moved from `sdk/AUTOMATIONS.md` to the server page. The example names `/work/project` and `Europe/Berlin`.
- `PLUGINS.md` said a change loads at the next restart. It now says a running daemon with the HTTP API loads it at once. Its table gained `@ahpd/tasks` and `@ahpd/activepieces`.
