---
title: A new chat gets a workspace of its own - implemented
date: 2026-11-21
refs:
  - git://b9e3ff94c
  - "[code://packages/sdk/src/host/chatworkspace.ts](../../../../packages/sdk/src/host/chatworkspace.ts)"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts)"
  - "[code://packages/sdk/src/host/admission.ts](../../../../packages/sdk/src/host/admission.ts)"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts)"
  - "[code://packages/sdk/test/chat-workspace.test.ts](../../../../packages/sdk/test/chat-workspace.test.ts)"
  - "[code://packages/sdk/test/users-gate-sessions.test.ts](../../../../packages/sdk/test/users-gate-sessions.test.ts)"
---

A client can now give a chat a workspace of its own. `createChat` reads `_meta['vscode.chatWorkspace']`, and `vscode/setChatWorkspace` moves a chat that has not started a turn. The three shapes are a scratch folder this host makes, a folder the chat works in, and a new worktree of a folder cut from a branch, whose prompt is the chat's first turn on creation. Both paths refuse what VS Code refuses, ask the calling window about a folder's trust, move with no continuation turn, and release the folder the chat left.

## What was built

- [`code://packages/sdk/src/host/chatworkspace.ts`](../../../../packages/sdk/src/host/chatworkspace.ts) - `ChatWorkspace` and its reader, `readCreateChatWorkspaceMeta`, the scratch-folder maker and remover, `requireNonScratchChatFolder`, `ChatForWorkspace` and `requireChatForWorkspace`, and `WorkspaceCaller` and `requireWorkspaceAuthority`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `createChat` reads the workspace before anything is made; it refuses one beside `workingDirectories`, a fork or a side chat, on the default chat, on an agent without `multipleDirectories`, in a scratch folder, and in another person's session. A worktree prompt becomes the first message, and the chat is moved before it is announced.
- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - `vscode/setChatWorkspace` checks the chat, leaves one already in the folder it asks for or in a scratch folder, refuses a second request, moves with `continuation: false` and the calling connection as `sender`, then releases the old folder and removes a scratch folder the chat leaves.
- [`code://packages/sdk/src/host/admission.ts`](../../../../packages/sdk/src/host/admission.ts) and [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `chat:create` and `chat:folders` for a `createChat` that asks for a workspace, and `chat:folders` for the method. The served count is 61.
- `packages/sdk/src/host/context.ts`, `host.ts` and `chatactions.ts` - `chatWorkspaceMoves`, which refuses a chat a second request and its first turn while its move runs.
- [`code://packages/sdk/test/chat-workspace.test.ts`](../../../../packages/sdk/test/chat-workspace.test.ts) - the three shapes on `createChat`, the three on the method, each refusal, the release and the scratch removal.
- [`code://packages/sdk/test/users-gate-sessions.test.ts`](../../../../packages/sdk/test/users-gate-sessions.test.ts) - two signed-in people: one may not give the other's chat a workspace.

## Verified

- `packages/sdk/test/chat-workspace.test.ts` passes, 21 tests.
- The sdk suite passes, 5218 tests, and the computer suite passes, 634 tests, under the lock. Both were before the ownership check.
- `pnpm typecheck` passes, and `pnpm boundary` passes.
- The run after the ownership check was in progress when this file was written. Its new case is the two-user one in `users-gate-sessions.test.ts`, so the sdk count will be higher.

## Departures from the plan

- "A chat of another session" is read as a chat no running session of this host holds, because `vscode/setChatWorkspace` names `{chat, workspace}` and no session.
- While a move runs, a second request is refused with "The chat is already being given a workspace." and the first message is refused with "The chat is being given a workspace."; the plan names the refusals and not their words.
- `vscode/setChatWorkspace` reads and checks a worktree `prompt` but ignores it, because the plan gives the prompt to task 01.
- A folder is released only when no other chat of the session still works in it and it is not the session's primary folder; a scratch folder the chat leaves is removed from disk. The plan says the folder is released and the scratch folder removed, without saying what the other chats still using it mean.
- A chat already in any folder directly under the chats root is left as it is, not only one in its own scratch folder.
- Task 02 also touched `context.ts`, `host.ts` and `chatactions.ts`, which its file list does not name.
- In review, the method had no per-session check: the gate's `chat:folders` is host-wide, `vscode/moveSession` only checks `sessionVisible`, which is legacy URI visibility, and `chat/workingDirectorySet` has no per-session check either. Both `setChatWorkspace` and a `createChat` with a workspace now refuse a session the caller does not own, unless the caller holds `session:*` or is the host's root connection, as `mayDispose` does.
- The two-user test is in `users-gate-sessions.test.ts`, which already has the directory fixtures, rather than in `chat-workspace.test.ts`.

## Left for later

- The sdk run after the ownership check, and the plan's final verification checklist, which is signed off when it passes.
- No live daemon or VS Code window was driven, so what a window makes of a moved chat was not checked end to end.
- A worktree `prompt` and an `initialMessage` sent together keep the `initialMessage`, which is what the code did before this plan.
