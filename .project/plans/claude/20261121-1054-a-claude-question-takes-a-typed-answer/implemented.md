---
title: A Claude question takes a typed answer - implemented
date: 2026-11-21
refs:
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts) - `questionRequest`"
  - "[decisions/a-claude-question-allows-a-typed-answer.md](../../../decisions/a-claude-question-allows-a-typed-answer.md) - why ahpd departs from VS Code here"
---

A Claude question goes out with `allowFreeformInput: true` unless its input says `false`, so a person can type an answer of their own.

## What was built

- [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts) - the flag, with the decision named.
- `packages/agent-claude/test/agent-claude-tool-input.test.ts` - the flags the request carries, with a question that says `false`.

## Verified

- The agent-claude suite passes, 695 cases, and the sdk suite, 5137 cases. Typecheck passes.

## Departures from the plan

- `agent-claude-questions.test.ts` is unchanged: the typed answer's path was already tested in `agent-claude-tool-input.test.ts`.
