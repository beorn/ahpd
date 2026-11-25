---
title: An agent sets a new session's folder, trust and computer - implemented
date: 2026-11-13
refs:
  - git://045197d4f
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - `placeSession`"
---

An agent's `placeSession` hook sets a new session's folder, trust, user settings and computer. PR #321 built it with the bot talk.

## What was built

- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `placeSession`. Trust needs `session:trust` on the plugin, and a machine source needs the person's `computer:write`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the session is made where the hook places it. `Start.owner` gives the backend the session's owner.

## Verified

- The bot, sdk and webhook suites. CI passed on #321.

## Departures from the plan

- None recorded.

## Left for later

- The checks by hand in [bot-talk-checks.md](../../../pending/bot-talk-checks.md).
