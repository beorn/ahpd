---
title: x-ahpd/backgroundToolCall moves one call
status: done
depends: [task-01-a-call-offers-to-move.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts#L508-L517](../../../../packages/sdk/src/host/vscodemethods.ts#L508-L517) - `vscode/stopBackgroundWork`, the checks and answers to copy"
  - "[code://packages/sdk/src/host/gate.ts#L67-L73](../../../../packages/sdk/src/host/gate.ts#L67-L73) - the method table and its grants"
---

## Objective

A client calls `x-ahpd/backgroundToolCall { chat, toolCallId }` and is answered `{ backgrounded: boolean }`.
The method asks for `chat:send`. A client knows it can call it by the flag on the call.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts:508-517` - serve `x-ahpd/backgroundToolCall` beside `vscode/stopBackgroundWork`, with the same checks.
- `UPDATE: packages/sdk/src/host/gate.ts:67-73` - add `'x-ahpd/backgroundToolCall': 'chat:send'`, with a comment on why it is not `chat:cancel`.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts:9` - raise the count of served methods to 53.
- `UPDATE: packages/sdk/test/host-movable-calls.test.ts` - the method's answers and refusals.

## Steps

1. Serve the method, reading `chat` and `toolCallId` with `stringParam`.
2. Refuse an empty `toolCallId`, a bad URI and a URI that is not a chat.
3. Use the words of `vscode/stopBackgroundWork` for each refusal.
4. Answer `{ backgrounded: await ctx.background.move(chat, toolCallId) }`.
5. Add the grant row to `gate.ts`.
6. Raise `SERVED` in the gate table test.
7. Run the staleness and wire tests, and add the method where they ask for it.

## Validation

- `packages/sdk/test/host-movable-calls.test.ts` holds these cases:
  - An offered call answers `true`.
  - An unknown chat, an unknown call and a completed call answer `false`.
  - The gate refuses a person without `chat:send`.
- `npx vitest run packages/sdk/test/wire.test.ts packages/sdk/test/host-movable-calls.test.ts` passes.

## Resume

Done on 2026-11-21.

- The method is not listed in `ahpd.methods`. Listing it put `ahpd.methods` on every host's handshake and root `_meta`, which ten tests and every client read as "this host serves plugin methods". The flag on the call is the offer instead.
- The grant refusal is tested in `host-movable-calls.test.ts`.

