---
title: A plugin's chat has an origin, an interactivity and tools - implemented
date: 2026-11-13
refs:
  - git://045197d4f
  - "[code://packages/sdk/src/types/plugin.ts](../../../../packages/sdk/src/types/plugin.ts) - `startChat`"
---

A plugin's chat has an origin, an interactivity and tools of its own. PR #321 built it with the bot talk.

## What was built

- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `startChat` takes an origin, an interactivity and the chat's own tools. A read-only chat refuses a client's turn, and a plugin chat may name a session tool.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a turn a plugin sends into a session it does not own is checked against the owner's policies.

## Verified

- The bot, sdk and webhook suites. CI passed on #321.

## Departures from the plan

- None recorded.

## Left for later

- The checks by hand in [bot-talk-checks.md](../../../pending/bot-talk-checks.md).
