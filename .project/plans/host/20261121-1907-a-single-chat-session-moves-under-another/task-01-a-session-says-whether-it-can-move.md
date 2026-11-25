---
title: A session says whether it can move
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L308-L318](../../../../packages/sdk/src/host/catalogue.ts#L308-L318) - where a chat's movability is read"
---

## Objective

A session's `_meta` carries `vscode.movable` while it can move under another session, and the host advertises `vscode.sessionMove`.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts` - the session's movable flag, beside the chat's.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.sessionMove` in the initialize `_meta`.
- `CREATE: packages/sdk/test/session-move.test.ts` - the flag and the moves.

## Steps

1. Set `vscode.movable` on a session's `_meta` while `chatMoves.enabled` is on and the default chat is its only chat.
2. Leave the session's workers out of that count.
3. Say the flag again when `chatMoves.enabled` changes and when the session gains or loses a chat.
4. Advertise `vscode.sessionMove` in the initialize `_meta`.

## Validation

- `packages/sdk/test/session-move.test.ts` - the flag on, off with the setting off, and off with a second chat.
- The sdk vitest suite passes.

## Resume
