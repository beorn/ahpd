---
title: A chat target follows its chat
status: done
depends: [02]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L76](../../../../packages/sdk/src/host/sessionmethods.ts#L76) - `createChatMover`"
  - "[code://packages/sdk/src/host/actions.ts#L729-L760](../../../../packages/sdk/src/host/actions.ts#L729-L760) - the create and update checks"
---

## Objective

A `chat` target sends each run's message to its chat, through the queue of task 02. The host keeps `target.session` right when the chat moves.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:729-760` - a `chat` target to a missing chat, or one the owner may not drive, is refused, and `session` is set by the host.
- `UPDATE: packages/sdk/src/host/automations.ts` - a `chat` run queues in its chat and fails when the chat is gone.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:76` - a moved chat updates each automation that targets it, with `automation/set`.
- `CREATE: packages/sdk/test/automation-chat-target.test.ts` - the refusal, the host's `session`, the run and the move.

## Steps

1. Refuse a `chat` target whose chat does not exist, or that the automation's owner may not drive.
2. Set `target.session` to the session that owns the chat, replacing what the client sent.
3. Queue each run's message in the chat with `enqueue`, and fail the run when the chat is gone.
4. Update the automation's `target.session` when its chat moves, and publish it with `automation/set`.

## Validation

- `packages/sdk/test/automation-chat-target.test.ts` - the host refuses a missing chat, and sets `session` itself.
- The same file - a run queues in the chat, and a moved chat updates the target.
- The sdk vitest suite passes.

## Resume

`actions.ts` refuses a chat target this host does not have, or one the owner may not drive, and writes the owning session into `target.session`. `beginInChat` sends each run to its chat: now when it is idle, and through `queueIn` when it is busy. It fails the run when the chat is gone. The chat mover calls `moveChatAutomations`, which updates each target through `retargeted`.
