---
title: A list holds runtime kinds
domain: plugin
status: planned
priority: high
created: 2026-11-26
revalidated: 2026-11-26
requires:
  - plans/plugin/20261126-0356-a-plugin-serves-a-list-and-its-kinds/plan.md
  - plans/plugin/20261126-0538-a-process-is-what-ahpd-runs/plan.md
refs:
  - git://6f428e565 - main when the plan was made, with the lists of #485
  - "[briefs/a-list-and-its-kinds.md](../../../briefs/a-list-and-its-kinds.md) - the shape these steps build"
  - "[code://packages/sdk/src/types/lists.ts#L104-L150](../../../../packages/sdk/src/types/lists.ts#L104-L150) - `ListKind`, which gains `start` and `stop`"
  - "[code://packages/sdk/src/plugins/validate.ts#L1218](../../../../packages/sdk/src/plugins/validate.ts#L1218) - `checkListKind`, which refuses `class: 'runtime'` today"
  - "[code://packages/sdk/src/lists/channel.ts#L157-L170](../../../../packages/sdk/src/lists/channel.ts#L157-L170) - `served`, where the live fields join a row"
  - "[code://packages/sdk/src/tunnels/channel.ts#L294-L310](../../../../packages/sdk/src/tunnels/channel.ts#L294-L310) - a tunnel kind's report, the pattern a runtime report copies"
---

## Goal

A kind of class `runtime`, such as a process-compose service, holds records of what can run. Starting one makes a [process](../20261126-0538-a-process-is-what-ahpd-runs/plan.md), and the row links its current process. The host calls `start` and `stop` only when a person asks.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `class: 'runtime'` gives a kind `start(row, report)` and `stop(row)` | the brief's *Step 2* | 01 |
| The host never calls `start` or `stop` by itself: a person runs `start` or `stop` on a row | Softov, 2026-11-26: "not by itself. but can change on the future", and [the decision](../../../decisions/a-runtime-kind-starts-only-when-asked.md) | 02 |
| `start` and `stop` are listed operations of every runtime kind, offered by the row's live `status` | (defaulted: a person needs a button for each) | 02 |
| `start` runs in a process, and the row has `process`, the URI of its current process | Softov, 2026-11-26, chose "One processes channel" | 02 |
| The row's live state, such as `status` and `url`, is read from its current process and added to the row | (defaulted: a service is a record, and what runs is its process) | 02 |
| A live field is marked `x-ahpd-live: true` in the schema, and a create or update that writes one is refused | the brief's *Two kinds* | 01 |
| The host calls `stop` on each running row when it closes | (defaulted: a process the host started does not outlive it) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-kind-is-runtime](task-01-a-kind-is-runtime.md) | todo | - |
| [02 - the-host-runs-a-runtime-row](task-02-the-host-runs-a-runtime-row.md) | todo | 01 |

## Risks and tradeoffs

- A daemon restart leaves every runtime row stopped until a person starts it, by the decision.

## Resume state

- **Done so far:** the plan.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the host keeps no row of a plugin's list.

## Final verification checklist

- [ ] A runtime row starts and stops by its operations, and its live fields reach the subscribers.
- [ ] No row starts by itself.
- [ ] `pnpm typecheck`, the sdk and server suites, and `pnpm docs:build` pass.
