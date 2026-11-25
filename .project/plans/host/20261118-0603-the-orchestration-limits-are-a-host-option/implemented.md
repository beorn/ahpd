---
title: The orchestration limits are a host option - implemented
date: 2026-11-18
refs:
  - git://9bd158ebd - the merge of #375
---

A host built with `createHost` can set how many sessions, chats and messages the session tools allow per budget.
The default stays VS Code's 50, 50 and 100.
The limit cases set small numbers, so each makes a few sessions instead of 50, and runs well inside its 5 s budget.

## What was built

- [01 - The counts are a host option](task-01-the-counts-are-a-host-option.md).
- [02 - The limit cases count to a few](task-02-the-limit-cases-count-to-a-few.md).

## Verified

- CI on #375 passed every check, Windows included, and it merged as `9bd158ebd` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
