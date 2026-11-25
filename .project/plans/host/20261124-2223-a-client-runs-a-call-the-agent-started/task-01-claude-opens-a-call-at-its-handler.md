---
title: Claude opens a client's call at its handler
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/clienttools.ts#L421-L498](../../../../packages/agent-claude/src/session/clienttools.ts#L421-L498) - the calls and the handler's wait"
  - "[code://packages/agent-claude/src/session/stream.ts#L360-L524](../../../../packages/agent-claude/src/session/stream.ts#L360-L524) - the report of a call, with the guard for a repeated message"
---

## Objective

A client's call is readied and offered when the CLI runs its handler, or when the person allows it, whichever is first.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts:360-524` - a client's call stays `streaming` here, with its input kept for the ready.
- `UPDATE: packages/agent-claude/src/session/stream.ts:560-640` - a client's call that ends while `streaming` is left as it is.
- `UPDATE: packages/agent-claude/src/session/clienttools.ts:421-498` - the handler readies and opens the reported call; a report alone does not.
- `UPDATE: packages/agent-claude/test/agent-claude-client-gone.test.ts` - the cases follow the new order.
- `UPDATE: packages/agent-claude/test/agent-claude-subagent.test.ts:497-530` - the worker's entry goes up at the handler.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the cases that expected an entry from a report.
- `CREATE: packages/agent-claude/test/agent-claude-client-call-order.test.ts` - the cases of the order.

## Steps

1. Write the failing case: a client that answers each entry at once, a report, then `canUseTool` for the same call.
2. In `assistant`, for a client's call, say `chat/toolCallStart` if nothing opened it, and keep the call `streaming`.
3. Keep the turn, the line and the input of the reported call in `clienttools.ts`, and say no `chat/toolCallReady`.
4. Handle a repeated message for that call once, by the id kept in step 3.
5. In `ranByClient`, wait for the report as today, then ready the call, stamp its start and open its entry.
6. Keep `allowCall` as it is, and make the handler join the call it opened without a second ready.
7. In `results`, leave a client's call that is still `streaming`, and raise no entry.
8. Drop the kept reports when the turn stops, the person refuses, or the client withdraws the tool.

## Validation

- Claude asks about the call: no entry before the confirmation, one entry after it, and one answer to the CLI.
- No question: no entry at the report, one at the handler, and one answer to the CLI.
- The handler runs before the report: the same result.
- A refused call, and a call a rule ends with no handler: no entry, and no ready.
- A message reported twice: one start, one ready, one entry.
- A worker's call: the entry names the worker's chat.
- A stop before the handler: the stop cancels the call, and the handler gets an answer.
- Run `pnpm vitest run packages/agent-claude` and then `pnpm typecheck`: both pass.

## Resume

