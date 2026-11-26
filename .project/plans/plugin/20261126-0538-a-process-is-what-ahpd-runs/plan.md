---
title: A process is what ahpd runs
domain: plugin
status: active
priority: high
created: 2026-11-26
revalidated: 2026-11-26
requires:
  - plans/plugin/20261126-0356-a-plugin-serves-a-list-and-its-kinds/plan.md
refs:
  - git://6f428e565 - main when the plan was made, with the lists of #485
  - "[briefs/a-list-and-its-kinds.md](../../../briefs/a-list-and-its-kinds.md) - the long operation and the run it answers with"
  - "[code://packages/sdk/src/types/kinds.ts](../../../../packages/sdk/src/types/kinds.ts) - `KindOperation`, which gains `long`"
  - "[code://packages/sdk/src/kinds/operations.ts#L353-L418](../../../../packages/sdk/src/kinds/operations.ts#L353-L418) - `invokeOperation`, which answers a long call with its process"
  - "[code://packages/sdk/src/types/automations.ts#L92-L125](../../../../packages/sdk/src/types/automations.ts#L92-L125) - `AutomationRun`, the lifecycle a process copies"
  - "[code://packages/sdk/src/host/snapshots.ts#L417](../../../../packages/sdk/src/host/snapshots.ts#L417) - the automation run channel, the pattern of a process's snapshot"
---

## Goal

A process is something ahpd runs: a service a runtime kind started, a deploy, later a CI job. A list's record says what can run, and a process is one run of it, with a lifecycle, progress and a log. A client follows a process on `x-ahpd-processes://<id>`, and stops it. The plugin keeps its processes, as a kind keeps its rows. This plan builds the channel and a long operation that answers with a process. [A list holds runtime kinds](../20261126-0538-a-list-holds-runtime-kinds/plan.md) starts services as processes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Services are records, and a process is what runs: a daemon ahpd controls, a deploy, a CI job | Softov, 2026-11-26: "services were the records, and runs were the process running" | 02 |
| Everything ahpd runs is a process on one channel, `x-ahpd-processes://<id>` | Softov, 2026-11-26, chose "One processes channel" | 02 |
| The plugin keeps every process, running and finished, and the host asks it for a process's state | Softov, 2026-11-26: "Yes, the plugin keeps runs" | 01 |
| A process has `origin` (its list, kind, row and operation), `lifecycle` (`pending`, `running`, `completed`, `failed`, `stopped`), `progress` and `log`, as an automation run has a lifecycle | (defaulted: the brief's "a lifecycle, progress, a log and cancel, as an automation run") | 01 |
| `running` is a resting state for a service and a passing one for a deploy | (defaulted: one lifecycle for both) | 01 |
| The kind answers its processes from where the work lives, and the host relays reports and keeps nothing | Softov, 2026-11-26, chose "The kind, from its own source" | 01 |
| A process URI is `x-ahpd-processes://<list>/<kind>/<id>`, so the path names the kind to ask | (defaulted: the host keeps no process, so it cannot look one up by id alone) | 02 |
| `long: true` on an operation says its call answers with a process, and a client knows before it invokes it | the brief's *What Softov chose while drafting* | 03 |
| The work of a process gets a report for its lifecycle, progress and log lines, and an abort signal | (defaulted: a stop needs a way in) | 02 |
| `x-ahpd/processes/stop` stops a process, under the grant of the operation that started it | (defaulted: as a run is stopped by a command) | 02 |
| A process is read with its list's `<name>:get` | (defaulted: a process is part of its list) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-kind-keeps-its-processes](task-01-a-kind-keeps-its-processes.md) | done | - |
| [02 - the-host-serves-processes](task-02-the-host-serves-processes.md) | done | 01 |
| [03 - a-long-operation-answers-a-process](task-03-a-long-operation-answers-a-process.md) | done | 02 |

## Risks and tradeoffs

- A plugin that keeps no processes loses them at a restart.
- The host holds a running process's abort signal in memory, so a restart ends the way to stop it.
- A plugin keeps a history of each start, where a service today only answers whether it runs.

## Resume state

- **Done so far:** all three tasks, on 2026-11-26. [implemented.md](implemented.md) holds the checks.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** the host keeps no row and no finished process of a plugin's list.

## Final verification checklist

- [x] A long operation answers with a process a client follows to its end.
- [x] A process can be stopped, and a finished one still reads from its plugin.
- [x] `pnpm typecheck`, the sdk and server suites, and `pnpm docs:build` pass.
