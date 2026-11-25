---
title: pi and cofold ask in every mode
status: done
depends: [task-01-the-start-carries-the-check.md]
layer: agent-pi, agent-cofold
refs:
  - "[code://packages/agent-pi/src/session.ts#L549-L580](../../../../packages/agent-pi/src/session.ts#L549-L580) - `decide`"
  - "[code://packages/agent-cofold/src/turnagent.ts#L393-L397](../../../../packages/agent-cofold/src/turnagent.ts#L393-L397) - `beforeTool`"
  - "[code://packages/agent-pi/test/agent-pi-asking.test.ts](../../../../packages/agent-pi/test/agent-pi-asking.test.ts) - pi's cases"
  - "[code://packages/agent-cofold/test/agent-cofold-questions.test.ts](../../../../packages/agent-cofold/test/agent-cofold-questions.test.ts) - cofold's cases"
---

## Objective

In pi and cofold, a call to a tool the operator sets `false` asks in every mode, and `dontAsk` refuses it.
In cofold, an approval remembered for the session does not settle that call.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:549-580` - `decide` reads `start.alwaysAsks` before the mode.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:393-397` - the call's decision reads `start.alwaysAsks` first.
- `UPDATE: packages/agent-pi/test/agent-pi-asking.test.ts` - pi's cases.
- `UPDATE: packages/agent-cofold/test/agent-cofold-questions.test.ts` - cofold's cases.

## Steps

1. In pi's `decide`, answer `ask` first when `alwaysAsks` answers true, in every mode but `dontAsk`.
2. In `dontAsk`, answer the block that mode gives a call that needs approval.
3. In cofold, read where the policy reads a remembered approval for the session and the tool.
4. Make the check answer before that approval and before the mode, with `ask`, or a refusal in `dontAsk`.
5. Leave every call the rule does not name as it is.

## Validation

- `agent-pi-asking.test.ts`: in `bypassPermissions`, `auto` and `acceptEdits`, a tool set `false` asks.
- `agent-pi-asking.test.ts`: in `dontAsk`, pi refuses the same tool.
- `agent-cofold-questions.test.ts`: the same three modes ask, `dontAsk` refuses, and a remembered approval does not settle it.
- The agent-pi suite and the agent-cofold suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- In pi, a mode that refuses the call still refuses it. `plan` refuses a write that the rule names, and does not ask about it.
- cofold's policy cannot ask past an approval it remembers, so the check is in `beforeTool`. It answers `approval`, or a refusal in `dontAsk`.
- cofold reads its remembered approval at `approvals/<session>/<tool>`. The hook deletes that key for a tool the rule names.
- ahpd never sends cofold `alwaysApprove`, so only a store another program shares holds such a key.
- The cofold case seeds the key in a memory store. The case fails when the delete is removed.
