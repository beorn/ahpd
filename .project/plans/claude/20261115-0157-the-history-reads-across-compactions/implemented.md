---
title: A Claude history reads across its compactions - implemented
date: 2026-11-18
refs:
  - git://9863785ca - the merge of #338
---

After a daemon restart, a Claude session shows every turn it ran, also the turns before its compactions.
Today it shows only the turns from its last compaction on, although the transcript file holds all of them.

## What was built

- [01 - The turns before a compaction read back](task-01-the-turns-before-a-compaction-read-back.md).
- [02 - A read-back turn draws its notices](task-02-a-read-back-turn-draws-its-notices.md).

## Verified

- CI on #338 passed every check, Windows included, and it merged as `9863785ca`.
- Each task file says what its cases check.

## Departures from the plan

- Task 02 was added on 2026-11-15, after the build of task 01 found that the SDK gives a system entry with no subtype. Session `8cf0f145` read back 13 turns with the branch, and 3 with main.

## Left for later

- none
