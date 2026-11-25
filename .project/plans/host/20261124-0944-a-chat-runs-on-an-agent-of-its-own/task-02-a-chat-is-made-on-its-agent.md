---
title: A chat is made on the agent it asks for
status: done
depends: [01]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1601-L1608](../../../../packages/sdk/src/host/sessionmethods.ts#L1601-L1608) - the refusal this task replaces"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1833-L1840](../../../../packages/sdk/src/host/sessionmethods.ts#L1833-L1840) - the agent a new chat takes"
  - "[code://packages/sdk/src/host/spawn.ts#L2062](../../../../packages/sdk/src/host/spawn.ts#L2062) - `foreign`"
---

## Objective

`createChat` with a `provider` other than the session's starts the chat on that agent. The chat's state and summaries say `provider`, and a restart starts it on the same agent.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1601-1608` - take `provider` while the setting is on, and refuse it while it is off.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1833-1840` - the new chat's agent is the asked one, else its source chat's, else the session's.
- `UPDATE: packages/sdk/src/host/spawn.ts` - record the chat's agent so a restart reads it.
- `CREATE: packages/sdk/test/chat-own-agent.test.ts` - the cases.

## Steps

1. Keep VS Code's refusal while the setting is off.
2. Refuse an unknown `provider` with `The agent <provider> is unknown or disabled.` and code `-32602`.
3. Refuse a `provider` that is off or paused with the sentence `agentRefusal` gives.
4. Pick the asked agent, else the source chat's for a fork or side chat, else the session's.
5. Treat a `provider` equal to the session's agent as no `provider`.
6. Put `provider` on the chat's state, its `ChatSummary` and its `SessionChatSummary`.
7. Record the chat's agent where the session records its chats, and start it on that agent after a restart.
8. Add cases: a chat on another agent, a fork of it, an unknown agent, the setting off, and a restart.

## Validation

- `chat-own-agent.test.ts`: the cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. State, rows and the record already had `provider`. `createChat` also asks who may use the agent, the policies and the session's machine. An asleep chat of another agent read its transcript from the session's agent, in `snapshots.ts` and `outputs.ts`; both are fixed.
