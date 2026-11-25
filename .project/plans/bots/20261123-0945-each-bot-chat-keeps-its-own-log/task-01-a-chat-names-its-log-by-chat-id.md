---
title: A chat names its log by its chat id
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/chat.ts#L1536-L1538](../../../../packages/bot/src/chat.ts#L1536-L1538) - where the log id and folder are chosen"
  - "[code://packages/bot/src/talks.ts#L85-L104](../../../../packages/bot/src/talks.ts#L85-L104) - `logIds`, which must keep seeing one file per session"
---

## Objective

A chat with a `chatId` reads and writes `logs/chats/<session id>/<chatId>.jsonl`. The session's default chat keeps `logs/<session id>.jsonl`.

## Files

- `UPDATE: packages/bot/src/chat.ts:1536-1538` - choose the folder and the id from `start.chatId`; the default chat is unchanged.
- `UPDATE: packages/bot/src/names.ts:47` - add `chatLogsOf(configDir, slug, session)`, the folder of one session's other chats.
- `UPDATE: packages/bot/src/plugin.ts` - a removal of a session's logs also removes its `chats/<session id>/` folder, if the removal path names the session's log.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the case of two Front chats and a restart.

## Steps

1. Add `chatLogsOf` in `names.ts`, joining `logsOf(configDir, slug)`, `chats` and `encodeURIComponent(session)`.
2. If `start.chatId` has a value, give `chat()` the folder `chatLogsOf(configDir, bot.id, idOf(start.uri))` and the id `start.chatId`.
3. Leave `start.resume ?? idOf(start.uri)` and `logsOf` for a start with no `chatId`.
4. Read the removal path in `plugin.ts`, and remove the session's `chats/` folder where it removes the session's log.
5. Add a case with two Front chats of one session, a turn in each, and a restart.
6. Check that each chat reads back only its own turns.

## Validation

- `bot-chat.test.ts`: the new case, and the case at line 301 unchanged.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/bot/test` passes.

## Resume

Done on 2026-11-23. `transcript` also reads the chats' folders, because the host reads a chat back by its `chatId`. `plugin.ts` needed no change: a bot's delete removes its whole folder.
