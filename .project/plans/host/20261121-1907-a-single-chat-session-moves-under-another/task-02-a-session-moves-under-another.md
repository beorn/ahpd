---
title: A single-chat session moves under another
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L65-L80](../../../../packages/sdk/src/host/sessionmethods.ts#L65-L80) - the chat mover"
  - "[code://packages/sdk/src/host/lifecycle.ts#L780](../../../../packages/sdk/src/host/lifecycle.ts#L780) - `removeSession`"
---

## Objective

`vscode/moveSession` moves a single-chat session's chat under the destination and ends the source session.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `moveSession`, through `movedTo`.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the method.
- `UPDATE: packages/sdk/src/host/gate.ts` - its grant, the one `moveChat` needs.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - an end of a session that leaves its chat's transcript and tree.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `UPDATE: packages/sdk/test/session-move.test.ts` - the move and each refusal.

## Steps

1. Refuse, in VS Code's reason and words, a move while chat moves are off and a move under itself.
2. Refuse a source with a second chat, or with a chat that its backend cannot resume.
3. Refuse with `sessionMoveRefusal` for the source and the destination.
4. Move the source's default chat with `movedTo` to the destination, placed after `after`.
5. End the source session, and leave the moved chat's transcript, worktree and folders in place.
6. Answer `{ session }` with the destination session.

## Validation

- `packages/sdk/test/session-move.test.ts` - the chat under the destination with its turns, and the source gone from the list.
- The same file - each refusal.
- The sdk vitest suite passes.

## Resume
