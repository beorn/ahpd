---
title: A process is what ahpd runs - implemented
date: 2026-11-26
refs:
  - git://60070037a - main the build started from
  - "[code://packages/sdk/src/lists/processes.ts](../../../../packages/sdk/src/lists/processes.ts) - the channel of processes and its stop"
---

A kind of a list may run processes: a service, a deploy, a CI job.
The kind answers them through `processes`, from where the work lives, and the host keeps none.
An operation with `long: true` answers its call with a process at once, and the kind's `invoke` runs in it.
A client follows a process at `x-ahpd-processes://<list>/<kind>/<id>`, lists them at `x-ahpd-processes://`, and stops one with `x-ahpd/processes/stop`.

## What was built

- [`code://packages/sdk/src/types/lists.ts`](../../../../packages/sdk/src/types/lists.ts) - `ListProcess`, `ListProcesses`, `ProcessReport`, `ProcessWork`, and `processChanged` on the handle.
- [`code://packages/sdk/src/types/kinds.ts`](../../../../packages/sdk/src/types/kinds.ts) - `long` on an operation.
- [`code://packages/sdk/src/lists/processes.ts`](../../../../packages/sdk/src/lists/processes.ts) - the channel, the relay of reports, and the stop command.
- [`code://packages/sdk/src/lists/channel.ts`](../../../../packages/sdk/src/lists/channel.ts) - a long call starts a process.
- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - the fold serves the channel, the command and the `process` grants where a kind keeps processes.

## Verified

- `list-processes.test.ts` runs 6 cases: the relay, a failure, both stops, the grant, the root list and the checks.
- The sdk suite runs 5405 cases and the server suite 2006, with no failure.
- `pnpm typecheck`, `pnpm build` and `pnpm docs:build` pass.

## Departures from the plan

- The kind keeps its processes from its own source, so the host has no `keep` call. Softov chose it on 2026-11-26.
- A process URI carries its list and kind in the path.
- The channel's grant is `process:get`, and `authorize` lets in a reader of the process's list.
- A stop asks the grant of the operation that started the process, else the list's `put`.
- `processes` is required only on a kind with a long operation. A runtime kind requires it in its own plan.

## Left for later

- [A list holds runtime kinds](../20261126-0538-a-list-holds-runtime-kinds/plan.md) starts a service as a process.
- A stop has no effect on a process the host ran before a restart, unless its kind can stop it.
