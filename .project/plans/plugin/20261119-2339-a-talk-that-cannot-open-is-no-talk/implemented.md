---
title: A talk that cannot open is no talk - implemented
date: 2026-11-19
refs:
  - git://b44c3e520
  - "[code://packages/sdk/src/plugins/plugins.ts](../../../../packages/sdk/src/plugins/plugins.ts)"
  - "[code://packages/bot/src/talks.ts](../../../../packages/bot/src/talks.ts)"
---

A bot hands a person only a talk that works. A talk counts while the host's store keeps its session with the config that names the bot, and the host can open it. After a restart, a talk made with no message is no talk. Neither is an old talk from a log with no record. Open chat makes a new one, and its Back answers.

## What was built

- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - `host.sessionOpens(uri)`, which asks `opens`, and `recorded`, which `sessionKept` answers from.
- [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts) - `sessionOpens` on `PluginHost`.
- [`code://packages/bot/src/talks.ts`](../../../../packages/bot/src/talks.ts) - `talk`, which asks `kept` and `opens`, used by `of`, `all` and `fromLogs`; a talk from a log tells the catalogue.
- `docs/plugins/PLUGINS.md`, `docs/plugins/BOTS.md` and the 0.15.0 notes say which read to ask and when a talk counts.

## Verified

- `plugin-session-opens.test.ts`, 4 cases, and a no-host case in `plugin-host.test.ts`.
- Two bot cases: a talk with no message after a restart, and an old log with no record. Each fails on the code before it and passes after.
- Suites: bot 274, push 58, webhook 124, sdk 4961. The computer suite fails `finds an adopted container again`, which fails on main too and is in `problems/computer-cases-time-out-on-a-busy-machine.md`.
- #386 and #387 passed `check` and `check-windows`. #387's first Windows run failed a cofold case, fixed in #388.
- Softov restarted his daemon on 2026-11-19: Open chat on Ember made a new talk, and Ember answered.

## Departures from the plan

- `sessionOpens` asks `opens` alone when a host is built. A session a plugin just started has no config row, so a store check first answered `false` for it.
- Task 03 came after #386: `opens` alone took Ember's talk of 2026-11-13 from its log, whose record named no bot. A talk now needs the store's record and `opens`.

## Left for later

- A talk with a message opening after a restart was not checked by hand. The bot cases and the reopen of open talks cover it.
