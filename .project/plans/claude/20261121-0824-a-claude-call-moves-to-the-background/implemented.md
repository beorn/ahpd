---
title: A Claude call moves to the background - implemented
date: 2026-11-21
refs:
  - git://eb832a04f - the merge of PR #407 that holds this plan's work
  - "[code://packages/agent-claude/src/session/workers.ts](../../../../packages/agent-claude/src/session/workers.ts) - `offerMove` and `noteMoved`, beside `stopOf`"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts) - the offer on `task_started` with `is_backgrounded: false`"
  - "[code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts) - the row reported before a moved call completes"
  - "[code://packages/agent-claude/test/agent-claude-movable-calls.test.ts](../../../../packages/agent-claude/test/agent-claude-movable-calls.test.ts) - the offer, the move, the row and the env switch"
---

A foreground Bash command or subagent of a Claude session can move to the background, as Ctrl+B does in Claude Code.
The backend offers the call through the host's movable calls, and the move is the SDK's own `Query.backgroundTasks(toolUseId)`.

## What was built

- [`code://packages/agent-claude/src/session/workers.ts`](../../../../packages/agent-claude/src/session/workers.ts) - `offerMove`, which offers a `local_bash` or `local_agent` task that started in the foreground, and `noteMoved`, which reports the row `shell:<task id>` or `subagent:<task id>`.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the offer on `task_started`, and the row on `task_updated` once the task is backgrounded.
- [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts) - the row is reported before the moved call completes.
- `movableCalls` carried from `Start` through `claude.ts` and `session/context.ts`.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md) - a foreground Bash or subagent call can move through `x-ahpd/backgroundToolCall`.

## Verified

- `packages/agent-claude/test/agent-claude-movable-calls.test.ts` has 7 tests, all passing with the fake SDK: the offer, the move with the tool_use id, the subagent row, no offer for a task that started in the background, the env switch, and a `false` from the SDK.
- The full `pnpm test:unit` run on the branch passed, and PR #407 passed CI before it merged.

## Departures from the plan

- No withdraw. The plan said to withdraw the offer on the call's result and on the terminal notification. The host clears the flag at completion, and a late move gets `false` from the SDK, so the withdraw adds nothing.
- The move reports the row itself, and the row is also reported on `task_updated` and before the completion. The order of those frames is not fixed, so one report is not enough.

## Left for later

- Nothing in this plan. The button that uses the move is in the host plan's "Left for later" list.
