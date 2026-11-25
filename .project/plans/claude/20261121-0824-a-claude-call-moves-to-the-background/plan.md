---
title: A Claude call moves to the background
domain: claude
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/host/20261121-0824-a-running-call-moves-to-the-background/plan.md
refs:
  - git://9003a0a1c - the last commit that holds the brief this plan covers, `.project/briefs/a-running-tool-call-moves-to-the-background.md`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.325 - `Query.backgroundTasks(toolUseId?)`: moves the one foreground task a tool_use started, answers `false` when none matches, throws when `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` is set; `SDKTaskStartedMessage.is_backgrounded` is set for `local_bash` and `local_agent` tasks
  - "[code://packages/agent-claude/src/session/query.ts#L1215-L1248](../../../../packages/agent-claude/src/session/query.ts#L1215-L1248) - `task_started`, `task_updated` and `background_tasks_changed`, read today"
  - "[code://packages/agent-claude/src/session/workers.ts#L400-L420](../../../../packages/agent-claude/src/session/workers.ts#L400-L420) - `stopOf`, a row's stop through `ctx.query`"
  - "[code://packages/agent-claude/src/session/workers.ts#L459-L470](../../../../packages/agent-claude/src/session/workers.ts#L459-L470) - a shell row's id is `shell:<task id>`"
  - "[code://packages/agent-claude/src/session/workers.ts#L499-L505](../../../../packages/agent-claude/src/session/workers.ts#L499-L505) - a subagent row's id is `subagent:<task id>`"
  - "[code://packages/agent-claude/src/session/workers.ts#L547-L560](../../../../packages/agent-claude/src/session/workers.ts#L547-L560) - `reconcileWork`, which reports the rows through `Start.backgroundTasks`"
  - "[code://packages/agent-claude/README.md#L209](../../../../packages/agent-claude/README.md#L209) - the README's paragraph on `Bash` results and backgrounded commands"
---

## Goal

A Claude Bash command or subagent that runs in the foreground can move to the background, as Ctrl+B does in Claude Code.
The Claude backend offers such a call through the host's movable calls, and the move is the SDK's own.
The rows, their stops and the end of the work already exist.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "backgroundTasks\(" packages/agent-claude/src` - ahpd never calls the SDK's move.
- `rg "is_backgrounded" packages/agent-claude/src` - read for a subagent's `foreground`, never offered to a client.

### Runtime path

```
SDK task_started { tool_use_id, task_id, is_backgrounded: false }
  -> Start.movableCalls.offer(chat, tool_use_id, move)
  -> x-ahpd/backgroundToolCall -> move -> query.backgroundTasks(tool_use_id)
  -> task_updated { is_backgrounded: true } and background_tasks_changed -> the row `shell:<task>` or `subagent:<task>`
  -> the call's tool_result is the SDK's background notice -> chat/toolCallComplete carries ahpd.backgroundWork
```

### Gaps

- No Claude call is offered to move.
- `Not found: a test of task_started with is_backgrounded false for a Bash call - searched "is_backgrounded" in packages/agent-claude/test.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| Claude's Bash and subagents move through `Query.backgroundTasks(toolUseId)` | "ok, but on the pi acp we will see", 2026-11-21, to the backend hook for Claude | 01 |
| A call is offered when `task_started` names it with `is_backgrounded: false`, and withdrawn at its result or its move | `(defaulted: the SDK's own report of a foreground task)` | 01 |
| The move answers the row id the backend already reports, `shell:<task id>` or `subagent:<task id>` | [`code://packages/agent-claude/src/session/workers.ts#L459-L505`](../../../../packages/agent-claude/src/session/workers.ts#L459-L505) | 01 |
| A session with `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` offers nothing | `(defaulted: the SDK throws on every move there)` | 01 |

## Proposed architecture

- **Data flow** - `task_started` gives the tool_use id and the task id. The backend offers the call with a `move` that calls `backgroundTasks(toolUseId)` and answers the row id.
- **Event flow** - The host sends the flag on the offer. The SDK's `task_updated` and `background_tasks_changed` make the row, as today. The host writes `ahpd.backgroundWork` on the completion.
- **State flow** - Nothing new is kept beyond the task id the backend already maps from the tool_use id.
- **Layer responsibilities** - `packages/agent-claude`: the offer, the move, the withdraw. `packages/sdk`: the host plan.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude offers its foreground calls](task-01-claude-offers-its-foreground-calls.md) | done | - |

## Risks and tradeoffs

- A call can run in a worker chat. The offer names the chat of the call, as `info.chat` says.
- A move that reaches the SDK after the task ended - the SDK answers `false`, and the method answers `{ backgrounded: false }`.

## Resume state

- **Done so far:** task 01, 2026-11-21, on the host plan's branch.
- **Next action:** open the pull request, then write `implemented.md` and set `status: built` once it merges.
- **Open questions:** none.
- **Watch out for:** a call that asked for the background from the start has `is_backgrounded: true` and is never offered. Check that ahpd's tool call id for a Claude call is the SDK's tool_use id.

## Final verification checklist

- [ ] A foreground Bash call carries `ahpd.backgroundToolCall: true` once its task starts.
- [ ] `x-ahpd/backgroundToolCall` moves it; the turn goes on; the row `shell:<task id>` shows with a stop.
- [ ] The completed call carries `ahpd.backgroundWork: shell:<task id>`.
- [ ] A foreground subagent moves the same way, with `subagent:<task id>`.
- [ ] With `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` set, no call is offered.
