---
title: The cost baseline starts from the transcript on resume
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L152-L211](../../../../packages/agent-claude/src/session/parts.ts#L152-L211) - `paid` and `costOf`, which get a seed"
  - "[code://packages/agent-claude/src/session/query.ts#L632-L654](../../../../packages/agent-claude/src/session/query.ts#L632-L654) - the resume, where the seed is read first"
  - "[code://packages/agent-claude/src/transcript.ts#L319](../../../../packages/agent-claude/src/transcript.ts#L319) - `sessionFiles`, the transcript path"
---

## Objective

Before a query resumes a CLI session, the cost baseline holds the transcript's last `cost-state` figures.
The first `result` after a resume is charged only what it added.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:319-336` - add `lastCostState(sessionId)`, which returns the `modelUsage` costs of the last `cost-state` line, or nothing.
- `UPDATE: packages/agent-claude/src/session/parts.ts:152-211` - add `seedCost(costs)`, which replaces `paid`, and `costUnknown()`, which makes the next `costOf` return nothing.
- `UPDATE: packages/agent-claude/src/session/query.ts:632-654` - on resume, fork and rewind, seed the baseline before the query starts.
- `UPDATE: packages/agent-claude/test/agent-claude-usage.test.ts` - add the resume cases.
- `UPDATE: .project/specs/usage.md` - say how a resumed Claude turn's cost is taken.

## Steps

1. Write `lastCostState` to read the transcript file from `sessionFiles` and keep the last line whose `type` is `cost-state`.
2. Return each `modelUsage[model].costUSD` that is a number, keyed by model.
3. Return nothing when the file is missing or unreadable, or holds no `cost-state` line.
4. Add `seedCost` to the parts, to clear `paid` and set each model's figure.
5. Add `costUnknown` to the parts, to make the next `costOf` set `paid` from its `result` and return nothing.
6. In the query, call `lastCostState` when the options resume, fork or rewind a CLI session.
7. Call `seedCost` with the figures, or `costUnknown` when `lastCostState` returned nothing.
8. Keep the `conversation_reset` path as it is.
9. Add a test: a `cost-state` of 19.017 and a first `result` of 19.272 give a turn cost of 0.255.
10. Add a test: after a resume with no `cost-state` line, the first turn has tokens and no cost.
11. Add a test: the second turn after that resume has its own cost.
12. Add a test: a fresh session with no resume reads no transcript.
13. Add the cost of a resumed Claude turn to `.project/specs/usage.md`.

## Validation

- `packages/agent-claude/test/agent-claude-usage.test.ts` holds the four cases of steps 9 to 12.
- `pnpm --filter @ahpd/agent-claude test` passes.
- `pnpm typecheck` passes.
- By hand: restart the daemon, send one turn on session `d5f25d91`, and read its line in `usage/2026-11-model.jsonl`. The cost is under $1.

## Resume

Built 2026-11-21.
`costStates` and `lastCostState` are in `transcript.ts`, and `seedCost` and `costUnknown` are in `parts.ts`.
A fork, a rewind and a session in a machine call `costUnknown`, as the plan's *Answers* says.
`agent-backends.md` has no text on cost, so the rule went to `usage.md`.
The agent-claude suite passes, 698 tests.

