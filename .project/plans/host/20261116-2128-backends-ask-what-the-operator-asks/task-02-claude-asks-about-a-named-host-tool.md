---
title: Claude asks about a named host tool
status: done
depends: [task-01-the-start-carries-the-check.md]
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L397-L399](../../../../packages/agent-claude/src/session/asking.ts#L397-L399) - the `confirm: false` shortcut"
  - "[code://packages/agent-claude/test/agent-claude-questions.test.ts](../../../../packages/agent-claude/test/agent-claude-questions.test.ts) - the question cases"
---

## Objective

A Claude host tool with `confirm: false` that the operator sets `false` asks the host, and is not allowed first.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts:397-399` - the shortcut reads `start.alwaysAsks` first.
- `UPDATE: packages/agent-claude/src/session/context.ts` - the context carries the start's check.
- `UPDATE: packages/agent-claude/test/agent-claude-questions.test.ts` - the cases.

## Steps

1. Carry `Start.alwaysAsks` on the session's context.
2. Take the `confirm: false` shortcut only when `alwaysAsks` is absent or answers false for the call.
3. Let a call it answers true for go on to the host's question, as any other call.
4. Keep the shortcut as it is for every tool the rule does not name.

## Validation

- `agent-claude-questions.test.ts`: `mcp__host__write_bash` set `false` raises a question.
- `agent-claude-questions.test.ts`: `mcp__host__write_bash` with no rule runs with no question.
- `agent-claude-questions.test.ts`: with no `alwaysAsks` on the start, the shortcut holds.
- The agent-claude suite passes.

## Resume

Built on 2026-11-16, awaiting review.

- The cases are in `host-tool-confirm.test.ts`, where the `confirm: false` cases already are, not in `agent-claude-questions.test.ts`.
- The case uses `mcp__host__post_message`, the tool that file already binds.
- The check reads the call's name alone, with no contributor, since the CLI names a host tool by its server.
