---
title: A disposed session leaves its machine - implemented
date: 2026-11-18
refs:
  - git://6d2741cf4 - the merge of #383
---

A client disposes a session that this process does not hold, and its disposable machine is let go as for a held session.
So a dispose after a restart leaves no container behind.

## What was built

- [01 - A dispose of a session not held lets its machine go](task-01-a-dispose-not-held-lets-the-machine-go.md).

## Verified

- CI on #383 passed every check, Windows included, and it merged as `6d2741cf4` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- The cases list the session on a second host over the same store and backend, then dispose it unopened.

## Left for later

- none
