---
title: Each agent sends the timing
status: done
depends: [01]
layer: "agents"
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L290-L340](../../../../packages/agent-claude/src/session/stream.ts#L290-L340) - Claude's reasoning part"
  - "[code://packages/agent-acp/src/mapping.ts#L71-L114](../../../../packages/agent-acp/src/mapping.ts#L71-L114) - ACP's reasoning run"
  - "[code://packages/agent-cofold/src/mapping.ts#L410-L440](../../../../packages/agent-cofold/src/mapping.ts#L410-L440) - cofold's reasoning block"
  - "[code://packages/agent-pi/src/mapping.ts#L186-L200](../../../../packages/agent-pi/src/mapping.ts#L186-L200) - pi's thinking block"
---

## Objective

In a running turn of each of the four agents, a reasoning part opens with `startedAt`. Its run ends with a `chat/reasoning` that carries its `duration`.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts:290-340` - open and close the run with the timer.
- `UPDATE: packages/agent-acp/src/mapping.ts:71-114` - open and close the run with the timer.
- `UPDATE: packages/agent-cofold/src/mapping.ts:410-440` - open and close the run with the timer.
- `UPDATE: packages/agent-pi/src/mapping.ts:186-200` - open and close the run with the timer.
- `CREATE: packages/agent-claude/test/agent-claude-reasoning-timing.test.ts` - the live case.
- `CREATE: packages/agent-acp/test/agent-acp-reasoning-timing.test.ts` - the live case.
- `CREATE: packages/agent-cofold/test/agent-cofold-reasoning-timing.test.ts` - the live case.
- `CREATE: packages/agent-pi/test/agent-pi-reasoning-timing.test.ts` - the live case.

## Steps

1. In each mapper, put the timer's `startedAt` on a new reasoning part.
2. Close the run when the mapper opens a part that is not reasoning, or starts a tool call.
3. Close every open run when the turn ends, before `chat/turnComplete`.
4. Add a case in each agent: a reasoning part, then a text part, gives `startedAt` and a `duration`.
5. Run `rg "chat/reasoning" packages/agent-*/test` and update each case that lists the actions in full.

## Validation

- The live case in each of the four new test files.
- Run each agent suite under the lock, one at a time, with `TMPDIR` set.

## Resume

Done on 2026-11-24. No mapper changed. The host times each agent's actions, and its workers' too. The merged delta window keeps the times a chunk carries.
