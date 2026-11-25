---
title: A reasoning part says how long it took - implemented
date: 2026-11-24
refs:
  - "[code://packages/sdk/src/host/reasoning.ts](../../../../packages/sdk/src/host/reasoning.ts) - the timer"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - where each action passes it"
---

The host times each run of reasoning, for every agent it runs. A part opens with `startedAt`, and its run ends with a `chat/reasoning` that has the `duration`. A restored Claude, pi or cofold chat has the times its log gives.

## Verified

- `reasoning-timer.test.ts`, and the restore cases of the Claude, pi and cofold agents.
- The whole repository's `pnpm test`: 611 files and 10517 cases pass. One pi case failed on its own new expectation, and the pi suite passes since: 283 cases.

## Departures from the plan

- The timer is in the host's dispatch, not in four mappers. The host keeps each chat's state, so one place covers every agent, its workers and a third party's agent.
- A part that arrives whole is not timed.
- The plan had a Claude frame's time as a block's start. It is the end: the CLI writes a frame as its block ends. The restored time includes the wait for the first word.
- The plan had a cofold message's `createdAt` as a fallback start. It is the end of the reply, so it is not used.
- pi gives a start only, and only for the thinking that opens a message.
