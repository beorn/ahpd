---
title: A single-chat session moves under another - implemented
plan: plans/host/20261121-1907-a-single-chat-session-moves-under-another/plan.md
---

## What exists now

- `describes` in `packages/sdk/src/host/facts.ts` sets `vscode.movable` on a session's `_meta` while `chatMoves.enabled` is on and its default chat is its only chat. A change of the setting says every session's `_meta` again.
- The initialize `_meta` advertises `vscode.sessionMove`.
- `createSessionMover` in `packages/sdk/src/host/sessionmethods.ts` serves `vscode/moveSession`. It refuses in VS Code's reasons, then moves the default chat through `createChatMover` with `asSession`, which lets a session's default chat move.
- `endMovedSession` in `packages/sdk/src/host/lifecycle.ts` ends the source. It lets the worktree record go before the teardown, and leaves the backend's conversation, the checkpoints and the scratch folder.
- A worktree that a moved chat works in counts as in use, through `recordedTree`.
- The method needs `chat:move`, as `moveChat` does.

## Verified

- `packages/sdk/test/session-move.test.ts` - the flag with the setting and a second chat, a move with the chat's turns, a null anchor, and the refusals.
- `packages/sdk/test/managed-worktrees.test.ts` - a worktree stays in use while a moved chat works in it.

## Departures from the plan

- A source session that this host is not running is refused with `notMovable`. VS Code loads a session for its move; this host moves only a session it runs.
- The worktree is not handed to the chat as VS Code hands it over. It stays on disk with no record, in use while the chat works in it.
