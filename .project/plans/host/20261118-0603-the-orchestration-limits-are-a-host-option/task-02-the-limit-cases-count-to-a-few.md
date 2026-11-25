---
title: The limit cases count to a few
status: done
depends: [task-01-the-counts-are-a-host-option.md]
layer: "tests"
refs:
  - "[code://packages/sdk/test/sessiontools.test.ts#L1179-L1350](../../../../packages/sdk/test/sessiontools.test.ts#L1179-L1350) - the seven cases that count to a limit"
---

## Objective

The seven limit cases set small counts through `orchestrationLimits`, and one case checks the default numbers by value.

## Files

- `UPDATE: packages/sdk/test/sessiontools.test.ts:1179-1350` - the hosts of the seven cases set `orchestrationLimits`, and their loops and expected numbers follow.
- `DELETE: .project/problems/the-51st-session-case-runs-at-its-budget.md` - this task fixes it.

## Steps

1. Give the host of each session case `orchestrationLimits: { sessions: 3 }`, and loop 3 times.
2. Give the host of the chat case `orchestrationLimits: { chats: 3 }`, and loop 3 times.
3. Give the hosts of the three message cases `orchestrationLimits: { messages: 5 }`, and loop 5 times.
4. Change each expected refusal to the number in force, such as "3 of 3".
5. Rename each case for the count it makes, such as "refuses the session past its tree's limit".
6. Add a case that expects `DEFAULT_ORCHESTRATION_LIMITS` to equal `{ sessions: 50, chats: 50, messages: 100 }`.
7. Add a case: `createHost` with `orchestrationLimits: { sessions: 0 }` throws an error that names `sessions`.
8. Delete the problem file.

## Validation

- `rg "i < (50|100)" packages/sdk/test/sessiontools.test.ts` finds nothing.
- Each limit case runs under 1 s in `vitest run packages/sdk/test/sessiontools.test.ts`.
- The sdk suite and the computer suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-18. The case that sends to two targets sets 6 messages, so its two sends a round come out even. The session cases went from about 3.5 s to under 0.6 s.

