---
title: A restore keeps the timing
status: done
depends: [01, 02]
layer: "agents"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L856](../../../../packages/agent-claude/src/transcript.ts#L856) - a restored Claude reasoning part"
  - "[code://packages/agent-pi/src/replay.ts#L213](../../../../packages/agent-pi/src/replay.ts#L213) - a restored pi thinking block"
  - "[code://packages/agent-cofold/src/transcript.ts#L446](../../../../packages/agent-cofold/src/transcript.ts#L446) - a restored cofold reasoning part"
---

## Objective

A restored Claude, pi or cofold chat has `startedAt` on each reasoning part, from its log. A Claude part has `duration` when the next frame has a time, and a cofold part when it has `endedAt`.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:856` - `startedAt` from the frame's `timestamp`, and `duration` up to the next frame's.
- `UPDATE: packages/agent-pi/src/replay.ts:213` - `startedAt` from the entry's `timestamp`.
- `UPDATE: packages/agent-cofold/src/transcript.ts:446` - `startedAt` and `duration` from the part's times, else `startedAt` from the message's `createdAt`.
- `UPDATE: packages/agent-claude/test/agent-claude-reasoning-timing.test.ts` - the restore case.
- `UPDATE: packages/agent-pi/test/agent-pi-reasoning-timing.test.ts` - the restore case.
- `UPDATE: packages/agent-cofold/test/agent-cofold-reasoning-timing.test.ts` - the restore case.

## Steps

1. In the Claude transcript, set `startedAt` from the thinking block's frame.
2. Set `duration` from that frame's time to the next frame's time, when both are valid.
3. In the pi replay, set `startedAt` from the entry's `timestamp`.
4. In the cofold transcript, set `startedAt` from the part's `startedAt`, else from the message's `createdAt`.
5. Set the cofold `duration` from the part's `startedAt` to its `endedAt`, when it has both.
6. Leave out a time that does not parse as a date.
7. Add a restore case in each of the three agents.

## Validation

- The restore case in each of the three test files.
- Run each agent suite under the lock, one at a time, with `TMPDIR` set.

## Resume

Done on 2026-11-24. A Claude frame's time is the end of its block, so a block runs from the frame before it.

- The pi log gives the start of a message that opens with its thinking.
- The cofold log gives a part's own times. A message's `createdAt` is not used.
