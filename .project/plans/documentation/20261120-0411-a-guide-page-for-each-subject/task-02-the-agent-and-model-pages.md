---
title: The agent and model pages
status: todo
depends: [task-01-the-guide-and-its-running-pages.md]
layer: "docs"
refs:
  - "[code://docs/plugins/agent-claude.md](../../../../docs/plugins/agent-claude.md) - the Claude plugin, with its logins"
  - "[code://docs/server/GATEWAY.md](../../../../docs/server/GATEWAY.md) - the model gateway"
---

## Objective

The guide has the five pages about agents and models: agents, subscriptions or API keys, the model gateway, plugins and bots.

## Files

- `CREATE: docs/guide/AGENTS.md` - the agents a host runs, from `server/PLUGINS.md` and the four agent pages.
- `CREATE: docs/guide/SUBSCRIPTIONS.md` - a subscription or an API key, from `plugins/agent-claude.md` and `server/VAULT.md`.
- `CREATE: docs/guide/GATEWAY.md` - the model gateway, from `server/GATEWAY.md`.
- `CREATE: docs/guide/PLUGINS.md` - installing, configuring and writing plugins, from `server/PLUGINS.md` and `plugins/PLUGINS.md`.
- `CREATE: docs/guide/BOTS.md` - bots, from `plugins/BOTS.md`.
- `UPDATE: docs/.vitepress/config.mts:22` - the five pages in the Guide group.
- `UPDATE: docs/README.md` - one line for each page in the `guide` section.

## Steps

1. Write each page in the four parts of the plan's *Page shape*.
2. Check each fact against the code and the page it links.
3. Add each page to the Guide group and to the `guide` section.

## Validation

- `pnpm docs:build` passes.
- Each link on the five pages resolves in the built site.
- Softov reads the five pages.

## Resume

