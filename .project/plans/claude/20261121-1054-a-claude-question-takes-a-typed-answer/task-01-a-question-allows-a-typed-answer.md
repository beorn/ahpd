---
title: A question allows a typed answer
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L107](../../../../packages/agent-claude/src/input.ts#L107) - the flag"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts#L798-L815](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts#L798-L815) - the case that pins it"
---

## Objective

Each question of a Claude `AskUserQuestion` goes out with `allowFreeformInput: true`, unless its input says `false`.

## Files

- `UPDATE: packages/agent-claude/src/input.ts:107` - the flag reads `question.allowFreeformInput !== false`, with the decision named.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts:798-815` - the flags the case expects, and a question that says `false`.
- `UPDATE: packages/agent-claude/test/agent-claude-questions.test.ts` - a typed answer reaches the tool.

## Steps

1. Change the flag in `questionRequest` to allow a typed answer unless the input says `false`.
2. Name the decision in the comment above it.
3. Update the case that pins the flags, and add a question that says `false`.
4. Check that a typed answer in `freeformValues` reaches the tool's `answers`.

## Validation

- `packages/agent-claude/test/agent-claude-tool-input.test.ts` - the flags are `true`, `true`, `false` for no flag, `true` and `false`.
- `packages/agent-claude/test/agent-claude-questions.test.ts` - a typed answer reaches the tool.
- The agent-claude vitest suite passes.

## Resume

`questionRequest` sends `allowFreeformInput: question.allowFreeformInput !== false`, with the decision named above it. The case in `agent-claude-tool-input.test.ts` expects `true`, `true`, `false`, the third question now saying `false`. The typed answer already reaches the tool: the cases at *Words typed beside a choice* in the same file send `freeformValues`. So `agent-claude-questions.test.ts` needed no change.
