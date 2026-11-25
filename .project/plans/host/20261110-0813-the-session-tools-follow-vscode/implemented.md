---
title: The session tools follow VS Code's main - implemented
date: 2026-11-10
refs:
  - git://d2bef38b5
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - the session tools"
---

The session tools send, move and create as VS Code main does at 171e90619. PR #281 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `send_message` takes `operation`, `delivery`, `messageId` and `expectedRevision`. `set_workspace` moves only the chat whose turn asked, for an agent with more than one folder. `create_session` works in a folder that is not a git repository.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `move_session` reorders, moves or splits a session's chats while `chatMoves.enabled` is on.

## Verified

- The session tool cases. CI passed on #281.

## Departures from the plan

- A chat cannot move itself during its own turn. VS Code moves it at the turn's end, and ahpd refuses it. The gap is in UPSTREAM.md Pass 8.

## Left for later

- The check by hand in [host-0813-moved-chat-checks.md](../../../pending/host-0813-moved-chat-checks.md).
