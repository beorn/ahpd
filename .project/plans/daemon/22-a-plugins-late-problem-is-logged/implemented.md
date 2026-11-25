---
title: A plugin's late problem is logged - implemented
date: 2026-10-15
refs:
  - git://bde1f48c
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
---

A line that a plugin says through `problem` after its load has answered goes to the daemon log at once.

## What was built

- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) - `problem` adds to `told` until the load answers, and writes to the log after that.
- [`code://packages/server/test/plugin-load.test.ts`](../../../../packages/server/test/plugin-load.test.ts) - a plugin that says a problem after its load, with the fixture `plugin-late-problem`.

## Verified

- `plugin-load.test.ts` passes on main.
- On Linux, 2026-10-15, at `3cf1dc13`: after a client read `bot://`, a hand edit of a bot's owner gave `bot: bots/boozi-2 changed owner; the bot was left as it was` in the daemon log.

## Departures from the plan

- none.

## Left for later

- An edit made before the bot store loads, or while the daemon is down, takes the new owner with no refusal. It is in [a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md](../../bots/20261123-0945-a-bot-owner-edited-by-hand-is-logged/plan.md).
