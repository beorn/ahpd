---
title: A move says chat moved
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L81-L92](../../../../packages/sdk/src/host/sessionmethods.ts#L81-L92) - `createChatMover`"
---

## Objective

After a chat moves to another session, its channel gets `chat/moved` with the new `session`, and `provider` and `schema` where they apply.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:81-92` - dispatch `chat/moved` once the move is done.
- `UPDATE: packages/sdk/test/session-move.test.ts` - the cases.

## Steps

1. Once the move has committed, dispatch `chat/moved` on each moved chat whose state is open.
2. Put `provider` on it when the chat's agent is not its new session's agent.
3. Put `schema` on it when the chat has its own config schema.
4. Add cases: a 1.1.0 client gets `chat/moved`, and a 1.0.0 client does not.

## Validation

- `session-move.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The action goes out after the chat leaves its session. Its new session lists it afterwards, because the new row is read off the state it moves. The chat's values follow in a `chat/configChanged`. The cases are in `chat-moved.test.ts`.
