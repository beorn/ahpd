---
title: A running call offers to move, and its _meta says so
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/background.ts](../../../../packages/sdk/src/host/background.ts) - the background rows; the offers sit beside them"
  - "[code://packages/sdk/src/types/background.ts](../../../../packages/sdk/src/types/background.ts) - the seam shapes the new one copies"
  - "[code://packages/sdk/src/host/spawn.ts#L297-L306](../../../../packages/sdk/src/host/spawn.ts#L297-L306) - the rewrite of a backend's tool call action"
  - "[code://packages/sdk/src/host/tooling.ts#L2522-L2528](../../../../packages/sdk/src/host/tooling.ts#L2522-L2528) - `background()` on a host tool's `ToolCall`"
---

## Objective

A provider can offer a running call to move, with a `move` that answers the row id.
While the offer stands, the call's `_meta` carries `ahpd.backgroundToolCall: true`, and its completion carries `ahpd.backgroundWork` when it moved.

## Files

- `UPDATE: packages/sdk/src/types/background.ts` - add `MovableCalls` (`offer(chat, toolCallId, move)`, `withdraw(chat, toolCallId)`) and `ChatMovableCalls`, bound to one chat.
- `UPDATE: packages/sdk/src/types/agent.ts:600-613` - add `Start.movableCalls?: MovableCalls`, beside `backgroundTasks`.
- `UPDATE: packages/sdk/src/types/host.ts:1678` - add `movable(): ChatMovableCalls` to `ToolCall`.
- `UPDATE: packages/sdk/src/host/background.ts` - hold the offers per chat, send the flag on an offer, move a call, record the moved row id, forget a session's offers.
- `UPDATE: packages/sdk/src/host/tooling.ts:2522-2528` - bind `movable()` to the call's chat and tool call id.
- `UPDATE: packages/sdk/src/host/spawn.ts` - lay the keys on a backend's `chat/toolCallComplete`, and keep `ahpd.backgroundToolCall` on a start, ready or content change of an offered call.
- `UPDATE: packages/sdk/src/host/spawn.ts:1515` - hand `movableCalls` on `Start`, as `backgroundTasks` is handed.
- `CREATE: packages/sdk/test/host-movable-calls.test.ts` - the offer, the flag, the completion keys, the withdraw.

## Steps

1. Add `MovableCalls` and `ChatMovableCalls` to `types/background.ts`, with `move: () => Promise<string | undefined>`.
2. Add `Start.movableCalls` and `ToolCall.movable()`, each with a doc comment that names the `_meta` keys.
3. In `background.ts`, keep `Map<chat, Map<toolCallId, Offer>>`, with the moved row id on the offer once moved.
4. On `offer`, read the call from the chat's held state.
5. For a running call, send `chat/toolCallContentChanged` with its content, and its `_meta` plus the flag.
6. On `withdraw` of a running call, send the same action with the key removed.
7. Add `move(chat, toolCallId)`, which calls the offer's `move`, records the row id, and answers whether it moved.
8. In `spawn.ts`, add `withBackgroundMeta(chat, action)` and run it where `withMcpContributor` runs, for the lead chat and for a worker chat.
9. On `chat/toolCallComplete` of an offered call, start `_meta` from the call's held `_meta`.
10. Remove `ahpd.backgroundToolCall`, add `ahpd.backgroundWork` when moved, and drop the offer.
11. On start, ready or content change of an offered call, keep `ahpd.backgroundToolCall` in the action's `_meta`.
12. Drop a chat's offers when its turn ends, and a session's in `forgetSession`.
13. Bind `movable()` in `tooling.ts`; a call with no `toolCallId` gets an offer that does nothing.
14. Write the tests.

## Validation

- `packages/sdk/test/host-movable-calls.test.ts` holds these cases:
  - An offer sets the flag on a running call, and a withdraw clears it.
  - A completion after a move carries `ahpd.backgroundWork` and not the flag.
  - A completion with no move carries neither key.
  - A backend's own `_meta` keys stay.
- `npx vitest run packages/sdk/test/host-movable-calls.test.ts packages/sdk/test/conformance.test.ts` passes.
- `npx tsc -p packages/sdk --noEmit` passes.

## Resume

Done on 2026-11-21.

- The one-call seam is `CallMovable`, not `ChatMovableCalls`: the host binds the chat and the call id.
- `MovableCalls` has a third verb, `moved(chat, toolCallId, row)`. A call that goes to the background without the method, such as `mode: 'async'`, reports its row with it.
- A move answers `Promise<boolean>`. The provider reports `moved` before the call completes, because a backend's completion can arrive before the move's answer.
- A backend's `chat/turnComplete`, `chat/turnCancelled` and `chat/error` drop the chat's records.
- Tests: `packages/sdk/test/host-movable-calls.test.ts`.

