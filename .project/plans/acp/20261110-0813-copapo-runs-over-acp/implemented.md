---
title: copapo runs over ACP - implemented
date: 2026-11-10
refs:
  - git://49a0aff13
  - "[code://packages/agent-acp/src/presets.ts](../../../../packages/agent-acp/src/presets.ts) - the copapo preset"
---

ahpd offers copapo, cofold's app, as an ACP agent, as it offers OpenCode or Goose. PR #275 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/machines/agents.ts`](../../../../packages/sdk/src/machines/agents.ts) - a `copapo` row in `knownAgents`: the install `npm i -g @cofold/copapo`, its `COPAPO_*` variables and its company.
- [`code://packages/agent-acp/src/presets.ts`](../../../../packages/agent-acp/src/presets.ts) - a preset that starts `copapo` with `['acp']`. It says that copapo over ACP ignores the MCP servers a client sends.
- [`code://packages/computer/images/versions.json`](../../../../packages/computer/images/versions.json) - a `copapo` machine part pinned at `0.1.0`, which keeps its configuration and `COFOLD_HOME` in `/ahpd/copapo`.

## Verified

- The agent-acp preset and machine cases, and the computer part cases. CI passed on #275.

## Departures from the plan

- `honoursTrust` stays unset, so a copapo session runs only in a folder the host trusts.

## Left for later

- None.
