---
title: A Dev Tunnel the service deleted is made again - implemented
date: 2026-11-18
refs:
  - git://1aab4e4da - the merge of #368
---

The plugin makes a Dev Tunnel again when the service no longer has it, at a start and while the daemon runs.
VS Code's CLI makes its own tunnel again the same way.
On 2026-11-17 the service deleted the dev daemon's tunnel.
Every start, stop and restart then failed with `Tunnel service error: Not Found`, a restart of the daemon included.

## What was built

- [01 - A missing tunnel is made again at start](task-01-a-missing-tunnel-is-made-again-at-start.md).
- [02 - A running tunnel deleted is made again](task-02-a-running-tunnel-deleted-is-made-again.md).
- [03 - The docs say a deleted tunnel comes back](task-03-the-docs-say-a-deleted-tunnel-comes-back.md).

## Verified

- CI on #368 passed every check, Windows included, and it merged as `1aab4e4da`.
- Each task file says what its cases check.
- Softov ran the deleted tunnel check by hand on his dev daemon on 2026-11-18, and they passed.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
