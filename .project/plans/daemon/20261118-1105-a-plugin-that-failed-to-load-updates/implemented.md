---
title: A plugin that failed to load can be updated from a client - implemented
date: 2026-11-18
refs:
  - git://98d33a5ac - the merge of #380
---

A client updates a first-party plugin that the daemon refused to load, such as a 0.14 backend on a 0.15 daemon.
This is the path 0.15's upgrade notes give a person with no shell on the host.

## What was built

- [01 - A refused plugin has an id a client can name](task-01-a-refused-plugin-has-a-usable-id.md).

## Verified

- CI on #380 passed every check, Windows included, and it merged as `98d33a5ac` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- The loader names a refused plugin too, so `refusedId` is used there and in `unimportedId`.

## Left for later

- A URL id with a `?`, which the commands still refuse: [problems/a-plugin-that-does-not-resolve-has-an-id-with-a-slash.md](../../../problems/a-plugin-that-does-not-resolve-has-an-id-with-a-slash.md).
