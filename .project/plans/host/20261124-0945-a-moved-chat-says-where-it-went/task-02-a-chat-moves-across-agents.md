---
title: A chat moves across agents
status: done
depends: [01]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L370-L377](../../../../packages/sdk/src/host/sessionmethods.ts#L370-L377) - the refusal of a chat of another backend"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L487-L491](../../../../packages/sdk/src/host/sessionmethods.ts#L487-L491) - the refusal across agents"
---

## Objective

While `multipleChatProviders.enabled` is on, a chat may move to a session of another agent. It keeps its own agent there.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:370-377` - allow the move of a chat of another backend while the setting is on.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:487-491` - allow a move across agents while the setting is on.
- `UPDATE: packages/sdk/test/session-move.test.ts` - the cases.

## Steps

1. Keep both refusals, in VS Code's words, while the setting is off.
2. Refuse a chat whose agent is unknown or off with `The agent <provider> of this chat is unknown or disabled; enable it before moving the chat.`
3. Keep the chat's agent and its own config in the new session's `held.backends`.
4. Record the chat's agent in its new session, so a restart starts it there.
5. Add cases: a move across agents, the refusal with the setting off, and a restart after the move.

## Validation

- `session-move.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. `keepChat` takes `null` for a chat that comes to run on its session's agent. The destination's policies and machine are asked about the agent. The cases are in `chat-moved.test.ts`; no case restarts after a move, and the record a restart reads is checked.
