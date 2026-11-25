---
title: A connector's wake counts against the cap - implemented
date: 2026-11-18
refs:
  - git://b4670176a - the merge of #379
---

A run a connector asks for by the automation's id is a wake like an event's.
It counts against the 20 runs an hour, and the automation's overlap mode decides what happens while a run of it is going.

## What was built

- [01 - A connector's wake goes through request](task-01-a-connectors-wake-goes-through-request.md).

## Verified

- CI on #379 passed every check, Windows included, and it merged as `b4670176a` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
