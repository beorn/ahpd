---
title: A damaged session file is shown, not dropped - implemented
date: 2026-11-25
refs:
  - git://2b164c19fd8a5e9856ce4846077b26547b23a652
---

## What exists

- `fileSessions` keeps a file it cannot read in place, and records its id and reason in `damaged()`.
- `load` accepts a row that is an object, of version 1, whose `id` is its file name's id. `null` is damaged.
- `save` skips a damaged id and logs it, `prune` leaves it, `forget` removes the file.
- `computeSessions` lists one failed row per damaged id, provider `unknown`, and drops the agent's own row for it.
- `removeSession` deletes a damaged session by removing its file.
- An unreadable folder logs one line.

## Verified

- `session-damaged.test.ts` runs the rows of issue 471 through a real host, with `none` and `last30Days`.
- `sessions.test.ts` holds the store cases.

## Departures

- The agent's copy of the conversation is not removed on delete, because no agent can be read from the file.
- The reasons of the plan's open points on actions were taken as: delete only.
