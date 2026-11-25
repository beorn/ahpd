---
title: Steering messages share the list
status: done
depends: [01]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/context.ts#L324-L333](../../../../packages/agent-claude/src/session/context.ts#L324-L333) - `steering`, the one slot"
  - "[code://packages/agent-claude/src/session/turns.ts#L474-L526](../../../../packages/agent-claude/src/session/turns.ts#L474-L526) - `steer`, which sets the slot, and the take-back that clears it"
  - "[code://packages/agent-claude/src/session/query.ts#L355-L365](../../../../packages/agent-claude/src/session/query.ts#L355-L365) - the input loop, which clears the slot when it reads the message by id"
  - "[code://packages/sdk/src/host/sleep.ts#L168](../../../../packages/sdk/src/host/sleep.ts#L168) - reads `steeringMessage` and `queuedMessages` as the waiting messages"
  - "[code://packages/sdk/src/host/spawn.ts#L431](../../../../packages/sdk/src/host/spawn.ts#L431) - moves `queuedMessages` on the way out"
  - "git://github.com/microsoft/vscode@0b4e0632b1f - `getPendingSteeringMessages`"
---

## Objective

agent-claude keeps a list of steering messages, and the chat state matches what the 1.1.0 reducer makes of its actions.
No steering id stays in the list after the CLI reads it.

## Files

- `CREATE: packages/agent-claude/test/agent-claude-steering-list.test.ts` - the steering list cases.
- `UPDATE: packages/agent-claude/src/session/context.ts:324-333` - `steering` becomes a list of `{ id, message }`.
- `UPDATE: packages/agent-claude/src/session/turns.ts:474-526` - `steer` appends to the list, and a take-back removes its own entry.
- `UPDATE: packages/agent-claude/src/session/query.ts:355-365` - a read removes the entry with its id and emits its `chat/pendingMessageRemoved`.
- `UPDATE: packages/sdk/src/host/sleep.ts:168` - the check reads `queuedMessages` of both kinds.

## Steps

1. Change the slot to a list, and append in `steer`.
2. In the input loop, remove the entry the CLI read by its id, and emit its removal.
3. Change each other reader of `ctx.steering` to the list.
4. Read each host reader of `queuedMessages` and `steeringMessage`, and record in Resume whether it means queued only or both.
5. Change a reader that means queued only to skip `kind: 'steering'`.

## Validation

- `packages/agent-claude/test/agent-claude-steering-list.test.ts` - two steers before a read, then two reads, leave an empty list.
- The same file - the chat state equals the 1.1.0 reducer applied to the emitted actions.
- `packages/sdk/test/conformance.test.ts` - replays `chat/pendingMessageSet` with both kinds.
- `pnpm vitest run` passes in sdk and agent-claude.

## Resume

`ctx.steering` is a list. A steer appends to it. The CLI's read removes the entry with its id and says its removal. A take-back removes its own entry, and a stop or a CLI put away empties the list. `agent-claude-steering-list.test.ts` holds back the CLI's reads: two steers, then two reads, say both removals. On the old slot it fails, with `s1` never removed. `sleep.ts` needed no change, since it counts both kinds already. The host keeps a steering entry until its backend says it read it, as the 1.1.0 reducer does. `host-steering.test.ts` now checks that no queued entry is left. The agent-claude suite passes, 688 cases.
