---
title: A moved chat says where it went - implemented
date: 2026-11-24
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - the mover"
  - "[code://packages/sdk/src/host/chatrecord.ts](../../../../packages/sdk/src/host/chatrecord.ts) - a chat that comes to its session's agent"
---

A chat that moves to another session says `chat/moved`. While chats with their own agents are on, it moves to a session of another agent and keeps its own.

## Verified

- `chat-moved.test.ts`: six cases.
- The whole repository's `pnpm test`: 613 files, 10534 cases.

## Departures from the plan

- The action goes out before the new session lists the chat. After it, the new row had the old agent.
- A `chat/configChanged` follows with the chat's own values, which `chat/moved` does not carry.
- The destination's policies and machine are asked about the agent.
- A worker's `chat/moved` has no `provider`, as a worker's state has none.
- No case restarts the host after a move. A case checks the record that a restart reads.
