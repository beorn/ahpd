---
title: cofold reads copapo's names - implemented
date: 2026-11-10
refs:
  - git://1c0430d8f
  - "[code://packages/agent-cofold/src/config.ts](../../../../packages/agent-cofold/src/config.ts) - the names it reads"
---

agent-cofold reads its harness configuration under copapo's names, as cofold's app papo is now copapo. papo's names are no longer read. PR #273 merged it on 2026-11-10.

## What was built

- [`code://packages/agent-cofold/src/config.ts`](../../../../packages/agent-cofold/src/config.ts) - `COPAPO_CONFIG`, `~/.config/copapo/config.json`, the nearest `.copapo.json`, and `COPAPO_BASE_URL`, `COPAPO_API_KEY` and `COPAPO_MODEL` over `COFOLD_*`.
- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - a machine gets `copapo/config.json` with `COPAPO_CONFIG`.
- [`code://docs/plugins/COMPUTERS.md`](../../../../docs/plugins/COMPUTERS.md) - the machine's file.

## Verified

- The agent-cofold cases for the configuration and the models. CI passed on #273.

## Departures from the plan

- None recorded.

## Left for later

- None. The release notes tell a person to move `~/.config/papo/config.json`, rename `PAPO_*`, and make a cofold machine again.
