---
title: Each chat of a bot session keeps its own log - implemented
date: 2026-11-23
refs:
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts) - the log a chat opens, and `transcript`"
  - "[code://packages/bot/src/names.ts](../../../../packages/bot/src/names.ts) - `chatLogsOf`"
---

A bot session with `threadSessions` off holds one Front chat for each thread. Each other chat of the session now has a log of its own. A restart opens each chat on its own turns.

## What was built

- [`code://packages/bot/src/names.ts`](../../../../packages/bot/src/names.ts) - `chatLogsOf(configDir, slug, session)`, the folder `logs/chats/<session>/`.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - a start with a `chatId` opens `logs/chats/<session>/<chatId>.jsonl`; `transcript` also reads those folders.

## Verified

- `bot-chat.test.ts`: the new case of two other chats and a restart. It fails without the change, where the default chat's log holds the other chats' turns.
- The bot suite: 16 files, 275 tests passed. `pnpm typecheck` and `pnpm boundary` pass.

## Departures from the plan

- `transcript` reads the chats' folders too. The host reads a chat back by its backend id, which is the `chatId` here. The plan's change alone left these chats unread after a restart.
- `plugin.ts` is unchanged. A bot's delete removes its whole folder, `logs/chats/` with it, and no path removes one session's log.

## Left for later

- None. A log that mixed chats before this change stays mixed.
