---
title: the command source
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L394-L430](../../../../packages/agent-cofold/src/transcript.ts#L394-L430) - how a message's source is shown; `command` is treated as user text"
  - "[code://packages/agent-cofold/src/mapping.ts#L559-L575](../../../../packages/agent-cofold/src/mapping.ts#L559-L575) - `command.started` and `command.finished`, already mapped"
---

## Objective

A message whose source is `command` is shown as a command, not as user text.

## Files

- `UPDATE: packages/agent-cofold/src/transcript.ts` - treat `command` like `skill` in the source check.

## Steps

1. Read the `command` source in the agents package types and confirm its name.
2. Read `transcript.ts` lines 394 to 430 and find the `skill` branch.
3. Handle `command` the same way, with its own text.
4. Add one test in `packages/agent-cofold/test` that a `command` message is not shown as user text.
5. Run `pnpm exec vitest run packages/agent-cofold`.

## Validation

- The new test passes, and the agent-cofold suite still passes.

## Result

No change. A `command` message is the typed slash line, and the transcript shows it as the turn's message, as the live turn drew it. `agent-cofold-compact.test.ts` checks this in "runs /compact as a command, and reads it back as the turn drew it". Treating it as `skill` would drop the line the person typed.
