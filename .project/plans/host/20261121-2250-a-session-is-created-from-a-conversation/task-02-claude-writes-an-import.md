---
title: Claude writes an imported conversation
status: done
depends: [task-01-staged-and-taken.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L58](../../../../packages/agent-claude/src/transcript.ts#L58) - the reader the writer mirrors"
---

## Objective

agent-claude writes an imported conversation as a Claude session file, and the session resumes from it.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts` - the writer of Claude's frames from AHP turns.
- `UPDATE: packages/agent-claude/src/claude.ts` - `importConversation`, and a resume from the written session.
- `CREATE: packages/agent-claude/test/import-conversation.test.ts` - the frames, a read back, and a resume.

## Steps

1. Write each turn's message as a user frame, and its response parts as assistant frames.
2. Write a tool call and its result as Claude's `tool_use` and `tool_result` pair.
3. Write a part with no Claude frame as text, and list such parts in `implemented.md`.
4. Read the file back with `turnsOf`, and compare it with the imported turns.
5. Resume the session from the file, with the CLI ahpd pins.

## Validation

- `packages/agent-claude/test/import-conversation.test.ts` - a read back equal to the import, and a resume.
- The agent-claude vitest suite passes.

## Resume
