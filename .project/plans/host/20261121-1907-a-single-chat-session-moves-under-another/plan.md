---
title: A single-chat session moves under another
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://bc9e0a4e0 - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Session move*"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L65-L80](../../../../packages/sdk/src/host/sessionmethods.ts#L65-L80) - `createChatMover`, the protocol's `moveChat`, whose `movedTo` this reuses"
  - "[code://packages/sdk/src/host/catalogue.ts#L308-L318](../../../../packages/sdk/src/host/catalogue.ts#L308-L318) - `isStructurallyMovable`, which refuses a session's default chat"
  - "[code://packages/sdk/src/host/catalogue.ts#L327-L331](../../../../packages/sdk/src/host/catalogue.ts#L327-L331) - `sessionMoveRefusal`, in VS Code's reasons"
  - "[code://packages/sdk/src/host/lifecycle.ts#L780](../../../../packages/sdk/src/host/lifecycle.ts#L780) - `removeSession`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentService.ts#L8261-L8297`, `moveSession` and `_movedSessionChat`; `#L8501-L8545`, its refusals; `node/agentHostChatMovability.ts#L496-L509`, the `vscode.movable` flag; `common/meta/vscode/agentHostSessionMoveMeta.ts`
---

## Goal

A client moves a session that holds one chat under another session, as VS Code's window does by drag and drop. The chat becomes a chat of the destination, and the source session ends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "moveSession|vscode.movable|sessionMove" packages/sdk/src` - nothing: ahpd serves `moveChat` only.
- `rg "chatMoves.enabled" packages/sdk/src` - the root setting that a chat move needs is there.

### Runtime path

```
vscode/moveSession {session, destination, after} -> refusals -> movedTo(the session's default chat, destination) -> the source session ends -> {session}
```

### Gaps

- A session's default chat never moves: `isStructurallyMovable` refuses it, as the protocol says for `moveChat`.
- A session's `_meta` has no `vscode.movable`, and the initialize `_meta` has no `vscode.sessionMove`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan session move | Softov, 2026-11-21, "plan worktree disk usage and session move" | 01, 02 |
| The initialize `_meta` advertises `vscode.sessionMove` whether or not chat moves are on | (defaulted: VS Code, `agentHostExtensionProtocol.ts#L128-L132`) | 01 |
| A session's `_meta` carries `vscode.movable` while `chatMoves.enabled` is on and its default chat is its only chat, its workers apart | (defaulted: VS Code `updateSession`) | 01 |
| A move while chat moves are off is refused with `disabled` | (defaulted: VS Code `_assertChatMovesEnabled`) | 02 |
| A move under itself is refused with `destinationNotFound`, "A session can't move under itself." | (defaulted: VS Code L8534-L8537) | 02 |
| A source with another chat is refused with `notMovable`; one whose chat its backend cannot resume is refused with `notMovable` too | (defaulted: VS Code `_movedSessionChat`, L8519-L8523) | 02 |
| The archived and workspace refusals are `sessionMoveRefusal`'s, for both sessions | (defaulted: the existing move) | 02 |
| The chat moves through the existing `movedTo`, so it keeps its backend id and its transcript | (defaulted: one mover, as `createChatMover` says) | 02 |
| The source session's record goes once its chat has moved, and its transcript stays as the chat's | (defaulted: VS Code, "the session ends") | 02 |
| The answer is `{ session }`, the destination session | (defaulted: VS Code L3954) | 02 |
| The method needs the same grant as `moveChat` | (defaulted: the gate's move) | 02 |

## Proposed architecture

- **Data flow** - the method checks the refusals, moves the default chat with `movedTo`, and then ends the source.
- **State flow** - `session/chatAdded` on the destination, then the source's removal as a deleted session is said.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session says whether it can move](task-01-a-session-says-whether-it-can-move.md) | done | - |
| [02 - A single-chat session moves under another](task-02-a-session-moves-under-another.md) | done | 01 |

## Risks and tradeoffs

- The source's removal must not delete what the moved chat still uses: its transcript, its worktree and its folders. The removal leaves the backend's record and the tree to the chat.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-21; see [implemented.md](implemented.md).
- **Next action:** none. Merged as #429, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** a client that names no chat gets the session's default chat. After the move, the chat is a peer chat of the destination, never its default.

## Final verification checklist

- [x] A test: `vscode.movable` follows `chatMoves.enabled` and a second chat.
- [x] A test: a move makes the chat the destination's, ends the source, and keeps the chat's turns.
- [x] A test: each refusal in VS Code's reason and words.
- [x] The gates pass: typecheck, boundary, and the sdk suite.
