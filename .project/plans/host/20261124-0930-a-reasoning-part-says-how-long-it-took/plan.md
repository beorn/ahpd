---
title: A reasoning part says how long it took
domain: host
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers reasoning timing
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `ReasoningResponsePart` in `types/channels-chat/state.ts` and `ChatReasoningAction` in `types/channels-chat/actions.ts`
  - git://github.com/microsoft/vscode@7e993177c9d9 - `node/copilot/copilotReasoningTiming.ts`, the timer this plan follows; VS Code's Claude agent sends no timing
  - "[code://packages/agent-claude/src/session/stream.ts#L290-L340](../../../../packages/agent-claude/src/session/stream.ts#L290-L340) - Claude opens a reasoning part and appends to it"
  - "[code://packages/agent-acp/src/mapping.ts#L71-L114](../../../../packages/agent-acp/src/mapping.ts#L71-L114) - ACP opens a reasoning run and appends to it"
  - "[code://packages/agent-cofold/src/mapping.ts#L410-L440](../../../../packages/agent-cofold/src/mapping.ts#L410-L440) - cofold opens a reasoning block and appends to it"
  - "[code://packages/agent-pi/src/mapping.ts#L186-L200](../../../../packages/agent-pi/src/mapping.ts#L186-L200) - pi opens a thinking block"
  - "[code://packages/agent-claude/src/transcript.ts#L856](../../../../packages/agent-claude/src/transcript.ts#L856) - a restored Claude reasoning part, from a frame with a `timestamp`"
  - "[code://packages/agent-pi/src/replay.ts#L213](../../../../packages/agent-pi/src/replay.ts#L213) - a restored pi thinking block, from an entry with a `timestamp`"
  - git://github.com/softov/cofold@f08ce52 - cofold plan `agent/20261124-0945-a-part-says-when-it-ran`, which gives each part `startedAt` and `endedAt`
  - "[code://packages/agent-cofold/src/transcript.ts#L446](../../../../packages/agent-cofold/src/transcript.ts#L446) - a restored cofold reasoning part, from a message with `createdAt`"
---

## Goal

A reasoning part says when it started and how long it took, in every agent ahpd runs. A client shows "Thought for 12 s" while a turn runs and after a restart, as 1.1.0 intends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "startedAt" packages/agent-*/src` on 2026-11-24 - no agent puts `startedAt` or `duration` on a reasoning part.
- `git grep "ChatReasoning"` in VS Code main - only the Copilot agent sends the timing.
- VS Code's Copilot timer starts at a run's first output and ends at the run's end.
- `rg -n "timestamp" packages/agent-claude/src/transcript.ts packages/agent-pi/src/replay.ts` - each Claude frame and each pi entry has a time.
- `rg -n "createdAt" packages/agent-cofold/src/transcript.ts` - a cofold message has a time; its parts do not, until the cofold plan is released.
- ACP has no time on a replayed chunk.

### Gaps

- No reasoning part has `startedAt` or `duration`, live or restored.
- No shared code times a run of output.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass, six plans by feature | Softov, 2026-11-24 | - |
| Live turns and restored history both carry the timing | Softov, 2026-11-24, chose "Live and restored" | 03 |
| One timer in the sdk, used by the four agents | `(defaulted: code that four places need is written once)` | 01 |
| A run of reasoning ends at the next part that is not reasoning, a tool call, or the turn's end | `(defaulted: VS Code's Copilot timer ends a run there)` | 01 |
| The end is a `chat/reasoning` with empty `content` and the `duration` | `(defaulted: 1.1.0 says an empty content updates only the timing)` | 01 |
| A restore without an end time gives `startedAt` only | `(defaulted: 1.1.0 says duration is absent when unknown)` | 03 |
| An ACP restore gives no timing | `(defaulted: an ACP replay has no time)` | 03 |
| cofold carries every part's start and end, and agent-cofold reads them | Softov, 2026-11-24, "also make cofold to carry timestamps", then chose "Every part's start and end" | 03 |
| agent-cofold reads the part times when present, and falls back to the message's `createdAt` | `(defaulted: transcripts written before the cofold release have none)` | 03 |

## Proposed architecture

- **Data flow** - a mapper gets `startedAt` from the timer for a new reasoning part, and the end action when the run ends.
- **Event flow** - `chat/responsePart` carries `startedAt`; the closing `chat/reasoning` carries `duration` and no text.
- **State flow** - the package reducer keeps both fields on the part, so a snapshot and a late client have them.
- **Layer responsibilities** - sdk: the timer · agent-claude, agent-acp, agent-cofold, agent-pi: call it from their mappers · agent-claude, agent-pi, agent-cofold: times on restore.
- **Source-of-truth files** - `packages/sdk/src/sessions/reasoning.ts`, which task 01 creates.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the sdk times a reasoning run](task-01-the-sdk-times-a-reasoning-run.md) | done | - |
| [02 - each agent sends the timing](task-02-each-agent-sends-the-timing.md) | done | 01 |
| [03 - a restore keeps the timing](task-03-a-restore-keeps-the-timing.md) | done | 01, 02 |

## Risks and tradeoffs

- A part a mapper never closes would keep its clock - the turn's end closes every open run.
- A nested worker's reasoning runs beside the parent's - the timer keys each run by its part id.

## Resume state

- **Done so far:** tasks 01 to 03, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** `duration` is whole milliseconds of 0 or more, and 0 is a recorded value. The cofold `@cofold/agents` release with part times is a tag only Softov pushes.

## Final verification checklist

- [ ] In each agent, a reasoning part opens with `startedAt` and ends with a `duration`.
- [ ] A restored Claude, pi and cofold chat has `startedAt` on its reasoning parts.
- [ ] The four agent suites pass, the sdk suite, and then the whole repo.
