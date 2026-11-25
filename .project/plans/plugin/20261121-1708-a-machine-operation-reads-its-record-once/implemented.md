---
title: A machine operation reads its record once - implemented
plan: plans/plugin/20261121-1708-a-machine-operation-reads-its-record-once/plan.md
---

## What exists now

- `locate` in `packages/computer/src/runtime.ts` answers where a machine is and the record it read. A container that `ps` found has no record yet.
- `containerOf` answers the name from `locate`. `heldOf` and `heldOrFail` answer the name and the record, read once.
- `look`, `remove`, `exec`, `bringBackOfMachine` and `followOfMachine` use the record they hold. `remove` hands its record to the bring-back.
- One disposable machine's life makes 3 `inspect` calls in place of 8, and 20 docker calls in place of 25.

## Verified

- `packages/computer/test/computer-disposable.test.ts` - `reads a disposable machine's record once per operation, from its make to its removal` counts 3 `inspect` calls and 20 docker calls.
- The computer suite passes, 634 cases.

## Departures from the plan

- The counts are 3 and 20, not 4 and 21: the plan counted the owner check at two reads, and it is one now too.
- `exec` read the record twice as well, and reads it once now. Each `docker exec` of the runtime saves one `inspect`.
