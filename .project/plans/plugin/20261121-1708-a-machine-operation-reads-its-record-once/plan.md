---
title: A machine operation reads its record once
domain: plugin
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://ce0447eeb - main when the plan was made, and the last commit that holds `briefs/a-machine-operation-reads-its-record-once.md`
  - "[problems/computer-cases-time-out-on-a-busy-machine.md](../../../problems/computer-cases-time-out-on-a-busy-machine.md) - the cases this is for"
  - "[code://packages/computer/src/runtime.ts#L2555-L2599](../../../../packages/computer/src/runtime.ts#L2555-L2599) - `containerOf` and `containerOrFail`, which read the record and keep only the name"
  - "[code://packages/computer/src/runtime.ts#L2609-L2623](../../../../packages/computer/src/runtime.ts#L2609-L2623) - `look`, which reads it a second time"
  - "[code://packages/computer/src/runtime.ts#L2750-L2762](../../../../packages/computer/src/runtime.ts#L2750-L2762) - `bringBackOfMachine`, which locates and reads it again"
  - "[code://packages/computer/src/runtime.ts#L2790-L2800](../../../../packages/computer/src/runtime.ts#L2790-L2800) - `followOfMachine`, the same pair"
  - "[code://packages/computer/src/runtime.ts#L3567-L3600](../../../../packages/computer/src/runtime.ts#L3567-L3600) - `remove`"
---

## Goal

Each operation of the computer runtime reads a machine's `docker inspect` record once, so each case of the computer suite starts fewer processes. One disposable machine's life drops from 25 docker calls to 21, and its `inspect` calls from 8 to 4.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- A stack trace of each `inspect` in `computer-disposable.test.ts`'s git-volume case, at `406667ee0`. The leave's bring-back makes 2. The removal makes 6: 2 from `owner` through `look`, 1 from `containerOrFail`, 1 from `remove`'s `recordOf`, and 2 from `bringBackOfMachine`.
- `rg -c "containerOf\(|containerOrFail\(" packages/computer/src/runtime.ts` - 13 callers.

### Runtime path

```
operation -> containerOf (inspect) -> name only -> recordOf (inspect again)
```

### Gaps

- `containerOf` throws away the record it read.
- `bringBackOfMachine` and `followOfMachine` locate the machine again inside `remove`, which already holds its record.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Cut the docker calls the runtime repeats | Softov, 2026-11-21, chose "Cut repeated docker calls" | 01 |
| `containerOf` answers the name and the record it read; a container found through `ps` has no record, and its caller reads one | (defaulted: the `ps` row has no labels or mounts) | 01 |
| The removal's second bring-back stays | (defaulted: the brief leaves it until what can run between the leave and the removal is checked) | - |
| The plugin's `owner` check before a removal stays a call of its own | (defaulted: it is a separate runtime method, and a cache across methods could answer from a stale record) | - |
| A test counts the docker calls of a disposable machine's life | (defaulted: the brief) | 01 |

## Proposed architecture

- **Data flow** - `containerOf` returns `{ at, record }`; `look`, `remove`, `bringBackOfMachine` and `followOfMachine` use that record.
- **State flow** - none: no record is kept between operations.
- **Layer responsibilities** - `packages/computer` only.
- **Source-of-truth files** - [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A machine's record is read once per operation](task-01-a-record-is-read-once-per-operation.md) | done | - |

## Risks and tradeoffs

- A record read at the start of `remove` is used after the machine is started again for the bring-back. The fields used, labels and mounts, do not change on a start.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: a disposable machine's life makes 3 `inspect` calls and 20 docker calls.
- [x] The gates pass: typecheck, boundary, and the computer suite.
