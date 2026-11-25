---
title: A chat is created in its own workspace
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1494](../../../../packages/sdk/src/host/sessionmethods.ts#L1494) - `createChat`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts`
---

## Objective

`createChat` with `_meta['vscode.chatWorkspace']` starts the new peer chat in the folder, worktree or scratch folder the value asks for.

## Files

- `CREATE: packages/sdk/src/host/chatworkspace.ts` - the value's reader and the checks both entries share.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `createChat` reads the value.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - a scratch folder of a chat's own, a move with no continuation turn, and `baseBranch` on `Move`.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.createChatWorkspace` in `_meta`.
- `CREATE: packages/sdk/test/chat-workspace.test.ts` - the three kinds and the invalid values.

## Steps

1. Port VS Code's reader, with its checks on the folder and the base branch.
2. Refuse an agent without a folder per chat, and a value beside `workingDirectories`, a fork or a side chat.
3. Start the chat in the folder, a new worktree of it, or a scratch folder of its own.
4. Cut a worktree from `baseBranch` when given, with the branch `cutTree` names.
5. Pass the calling connection as the move's `sender`.
6. Refuse a folder inside a chat's scratch folder.
7. Advertise `vscode.createChatWorkspace`.

## Validation

- `packages/sdk/test/chat-workspace.test.ts` - each kind, and each invalid value.
- The sdk vitest suite passes.

## Resume
