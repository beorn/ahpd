---
title: ACP opens a client's call at its request
status: done
depends: []
layer: agent-acp
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L224-L266](../../../../packages/agent-acp/src/mapping.ts#L224-L266) - the ready of a call, and the calls to open"
  - "[code://packages/agent-acp/src/session/handlers.ts#L608-L720](../../../../packages/agent-acp/src/session/handlers.ts#L608-L720) - the permission request"
  - "[code://packages/agent-acp/src/session/clientcalls.ts#L194-L253](../../../../packages/agent-acp/src/session/clientcalls.ts#L194-L253) - which call a `tools/call` is for"
---

## Objective

A client's call is readied and offered when its `tools/call` arrives, or when the person allows it, whichever is first.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts:253-266` - a client's call that is not finished is neither readied nor opened by a report.
- `UPDATE: packages/agent-acp/src/types.ts:638` - `opening` goes if nothing uses it.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:397` - the open after an update goes.
- `UPDATE: packages/agent-acp/src/session/clientcalls.ts:194-253` - `callFor` looks among the reported calls that no request took, and readies and opens the one it picks.
- `UPDATE: packages/agent-acp/test/agent-acp-client-tool.test.ts` - the cases of the order.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - the cases that expected an entry from a report.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs` - `mper=` asks for the permission of a reported call.

## Steps

1. Write the failing case: `in_progress`, a client that answers at once, then `session/request_permission` for the same call.
2. Keep a client's call `streaming` in `mapping.ts` until its request, its permission or its end.
3. Make `callFor` choose among the unfinished reported calls of that owner and tool that no request has taken.
4. Keep the order of the choice: the request's id, the lone call, the arguments, a row of its own.
5. Ready and open the chosen call, unless the person's confirmation did it already.
6. Say no ready for a call that ends with no request.

## Validation

- The permission comes after `in_progress`: no entry before the confirmation, one entry and one answer after it.
- No permission: no entry at the report, one at the `tools/call`.
- Two calls of one tool at once: each request gets its own call by its arguments.
- The agent reports no call: a row of its own, as today.
- Run `pnpm vitest run packages/agent-acp` and then `pnpm typecheck`: both pass.

## Resume

