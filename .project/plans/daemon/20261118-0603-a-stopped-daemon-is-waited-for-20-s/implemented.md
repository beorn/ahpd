---
title: A stopped daemon is waited for 20 s - implemented
date: 2026-11-18
refs:
  - git://b33bd3021 - the merge of #374
---

The server cases that wait for a stopped daemon to leave give it 20 s, so a busy machine does not fail them.
Today the wait is 5 s, and a restart spends 3 s of it on its own delay before it starts to stop.

## What was built

- [01 - gone waits 20 s for a stopped daemon](task-01-gone-waits-20-s.md).

## Verified

- CI on #374 passed every check, Windows included, and it merged as `b33bd3021` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
