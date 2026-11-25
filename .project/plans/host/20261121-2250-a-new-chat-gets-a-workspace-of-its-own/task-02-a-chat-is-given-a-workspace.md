---
title: A chat that has not started is given a workspace
status: done
depends: [task-01-a-chat-is-created-in-its-workspace.md]
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentService.ts#L7263-L7392`, `setChatWorkspace`
---

## Objective

`vscode/setChatWorkspace {chat, workspace}` moves a peer chat that has not started a turn to the workspace it asks for.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the method.
- `UPDATE: packages/sdk/src/host/chatworkspace.ts` - the refusals of a chat that exists.
- `UPDATE: packages/sdk/src/host/gate.ts` - `chat:folders` for the method.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `UPDATE: packages/sdk/test/chat-workspace.test.ts` - the method and its refusals.

## Steps

1. Refuse the default chat, a chat of another session, and a chat not made by a person.
2. Refuse a chat with a turn, a queued message or a steering message.
3. Refuse a second request for the same chat while the first runs, and a first message meanwhile.
4. Refuse a folder inside a chat's scratch folder.
5. Leave a chat that already works only in the asked folder, or in its own scratch folder.
6. Move the chat with `moveChatWorkspace`, with the calling connection as `sender` and no continuation turn.
7. Release the folder it left, and remove its old scratch folder, after the move.

## Validation

- `packages/sdk/test/chat-workspace.test.ts` - a move, each refusal, and the release.
- The sdk vitest suite passes.

## Resume
