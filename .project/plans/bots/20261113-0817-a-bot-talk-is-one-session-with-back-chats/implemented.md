---
title: A talk with a bot is one session with its Back chats - implemented
date: 2026-11-13
refs:
  - git://045197d4f
  - "[code://packages/bot/src/talks.ts](../../../../packages/bot/src/talks.ts) - the talks"
---

A person talks to a bot in one `bot-chat` session, the talk. Its Front runs no model, and the bot works in a Back, a chat of the same session. PR #321 built it with two host plans.

## What was built

- [`code://packages/bot/src/talks.ts`](../../../../packages/bot/src/talks.ts) - one talk for each owner and bot, with `secondSession: allow` for more. A turn a restart left open opens again when the daemon listens.
- [`code://packages/bot/src/names.ts`](../../../../packages/bot/src/names.ts) - the Back's title, `@main/<bot>/<person>`.
- [`code://packages/bot/src/post.ts`](../../../../packages/bot/src/post.ts) - the Back is offered `post_message` and `send_message`. Where no Front turn waits, a post or a question opens a bot turn.
- [`code://packages/webhook/src/bot.ts`](../../../../packages/webhook/src/bot.ts) - `threadSessions` gives each thread a session of its own.

## Verified

- The bot, sdk and webhook suites. CI passed on #321.

## Departures from the plan

- None recorded.

## Left for later

- The checks by hand in [bot-talk-checks.md](../../../pending/bot-talk-checks.md).
