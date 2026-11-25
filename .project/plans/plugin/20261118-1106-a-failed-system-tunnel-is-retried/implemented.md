---
title: A tunnel refused at its start is tried again - implemented
date: 2026-11-18
refs:
  - git://4169f7fb5 - the merge of #381
---

A tunnel whose start the Dev Tunnels service refused with 401 starts again by itself.
It is tried again after a delay, and when its connector holds a new token.
So a restart no longer leaves the host's own tunnel down.

## What was built

- [01 - A start the service refused is tried again](task-01-a-refused-start-is-tried-again.md).

## Verified

- CI on #381 passed every check, Windows included, and it merged as `4169f7fb5` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- The waits are a kind option, `retryMs`, so the cases run in milliseconds.

## Left for later

- none
