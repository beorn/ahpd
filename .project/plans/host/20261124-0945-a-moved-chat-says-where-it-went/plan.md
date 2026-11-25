---
title: A moved chat says where it went
domain: host
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/20261124-0944-a-chat-runs-on-an-agent-of-its-own/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers `chat/moved`
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `chat/moved` with `session`, `provider` and `schema`
  - git://github.com/microsoft/vscode@7e993177c9d9 - `node/agentHostStateManager.ts` `_announceChatsMoved`; `node/agentService.ts` `_checkCrossAgentChatMove`, its refusals and their words
  - "[code://packages/sdk/src/host/sessionmethods.ts#L81-L92](../../../../packages/sdk/src/host/sessionmethods.ts#L81-L92) - `createChatMover`, which dispatches no `chat/moved`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L370-L377](../../../../packages/sdk/src/host/sessionmethods.ts#L370-L377) - a chat of another backend is refused a move to a session of its own"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L487-L491](../../../../packages/sdk/src/host/sessionmethods.ts#L487-L491) - a move between sessions of different agents is refused"
  - "[code://packages/sdk/src/host.ts#L798-L808](../../../../packages/sdk/src/host.ts#L798-L808) - a client before 1.1.0 is not sent an action its version does not know"
---

## Goal

A chat moved to another session says where it went, so every client of the chat follows it. While chats of other agents are on, a chat may move to a session of another agent and keeps its own agent there.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "chat/moved" packages/sdk/src` on 2026-11-24 - only the version check names it.
- `rg -n "differentProvider" packages/sdk/src/host/sessionmethods.ts` - two refusals, in VS Code's words.

### Gaps

- No move dispatches `chat/moved`.
- A move across agents is refused even when chats of other agents are on.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass, six plans by feature | Softov, 2026-11-24 | - |
| `chat/moved` goes on the chat's channel after every move to another session | `(defaulted: 1.1.0 and VS Code)` | 01 |
| It carries `provider` when the chat's agent is not its new session's, and `schema` when the chat has its own | `(defaulted: VS Code's `_announceChatsMoved`)` | 01 |
| A client before 1.1.0 gets no `chat/moved` | [`code://packages/sdk/src/host.ts#L798-L808`](../../../../packages/sdk/src/host.ts#L798-L808) | 01 |
| A move across agents is allowed while `multipleChatProviders.enabled` is on, and the chat keeps its agent | `(defaulted: VS Code's `_checkCrossAgentChatMove`)` | 02 |
| An unknown or off agent is refused in VS Code's words | `(defaulted: VS Code's refusal)` | 02 |

## Proposed architecture

- **Event flow** - after the move commits, `chat/moved` goes on each moved chat's channel.
- **State flow** - a chat that keeps an agent other than its new session's is kept in the new session's `held.backends`.
- **Layer responsibilities** - sdk host: the mover and its refusals.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a move says chat moved](task-01-a-move-says-chat-moved.md) | done | - |
| [02 - a chat moves across agents](task-02-a-chat-moves-across-agents.md) | done | 01 |
| [03 - the documents say it](task-03-the-documents-say-it.md) | done | 02 |

## Risks and tradeoffs

- A chat moved across agents to another machine - the machine refusal stays, so it does not move.

## Resume state

- **Done so far:** tasks 01 to 03, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** a chat whose state no client opened has no subscriber; skip it, as VS Code does.

## Final verification checklist

- [ ] A move sends `chat/moved` to a 1.1.0 client and not to a 1.0.0 one.
- [ ] A chat moves to a session of another agent with the setting on, and keeps its agent.
- [ ] The move is refused with the setting off, in VS Code's words.
- [ ] The sdk suite passes, and then the whole repo.
