---
title: Pi and cofold write an imported conversation
status: done
depends: [task-01-staged-and-taken.md]
layer: "agent-pi, agent-cofold"
refs:
  - "[code://packages/agent-pi/src/transcript.ts](../../../../packages/agent-pi/src/transcript.ts) - pi's reader"
  - "[code://packages/agent-cofold/src/transcript.ts](../../../../packages/agent-cofold/src/transcript.ts) - cofold's reader"
---

## Objective

pi and cofold write an imported conversation as their own history where their formats allow it. Where they do not, they do not offer the import.

## Files

- `UPDATE: packages/agent-pi/src/transcript.ts` - the writer, or nothing when pi cannot load it.
- `UPDATE: packages/agent-pi/src/agent.ts` - `importConversation`.
- `UPDATE: packages/agent-cofold/src/transcript.ts` - the writer, or nothing when cofold cannot load it.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `importConversation`.
- `CREATE: packages/agent-pi/test/import-conversation.test.ts` - a read back and a resume.
- `CREATE: packages/agent-cofold/test/import-conversation.test.ts` - a read back and a resume.

## Steps

1. Read how each agent stores and loads a session's history.
2. Write the turns in that format, with each reader's shape as the check.
3. Resume a session from the written history.
4. Stop for an agent that cannot load a history it did not write, and say why in `deferred.md`.

## Validation

- Each agent's test - a read back equal to the import, and a resume.
- The agent-pi and agent-cofold vitest suites pass, one at a time.

## Resume
