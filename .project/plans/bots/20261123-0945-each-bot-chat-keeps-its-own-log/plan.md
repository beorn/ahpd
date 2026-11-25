---
title: Each chat of a bot session keeps its own log
domain: bots
status: built
priority: medium
created: 2026-11-23
revalidated: 2026-11-23
refs:
  - git://e68555ee0 - the last commit that holds `problems/the-chats-of-a-bot-talk-share-one-log.md`, which this plan fixes
  - git://e68555ee0 - main when the plan was written
  - "[code://packages/bot/src/chat.ts#L1536-L1538](../../../../packages/bot/src/chat.ts#L1536-L1538) - the log id is `start.resume ?? idOf(start.uri)`, the same for every chat of a session"
  - "[code://packages/bot/src/chat.ts#L255-L259](../../../../packages/bot/src/chat.ts#L255-L259) - `fileOf(dir, id)`, one file per id in the bot's `logs/` folder"
  - "[code://packages/bot/src/chat.ts#L577-L584](../../../../packages/bot/src/chat.ts#L577-L584) - `chat()` reads the log at `fileOf(dir, id)`, and already skips the open turn for a chat with a `chatId`"
  - "[code://packages/bot/src/talks.ts#L85-L104](../../../../packages/bot/src/talks.ts#L85-L104) - `logIds` reads every `*.jsonl` at the top of `logs/` as a session id"
  - "[code://packages/bot/src/names.ts#L47](../../../../packages/bot/src/names.ts#L47) - `logsOf`, the bot's `logs/` folder"
  - "[code://packages/sdk/src/types/agent.ts#L270-L287](../../../../packages/sdk/src/types/agent.ts#L270-L287) - `Start.chatId`, set for every chat that is not the session's default chat"
  - "[code://packages/bot/test/bot-chat.test.ts#L301](../../../../packages/bot/test/bot-chat.test.ts#L301) - the restart case this plan copies for two chats"
---

## Goal

A bot session with `threadSessions` off holds one Front chat for each thread. Today every chat of that session reads and writes one log, so after a restart each chat opens with the turns of all of them. Each chat that is not the session's default chat gets a log of its own, so a restart opens each chat on its own turns.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "start.resume|chatId" packages/bot/src/chat.ts` - the log id ignores `chatId`; `chat()` reads `chatId` only to skip the open turn.
- `rg "jsonl" packages/bot/src` - `talks.ts` and `plugin.ts` read the top of `logs/` as one file per session.

### Runtime path

```
host starts a chat (Start.chatId) -> bot-chat agent open -> chat(start, bot, id, mark, dir) -> logAt(fileOf(dir, id)) -> the chat's turns after a restart
```

### Gaps

- A chat with a `chatId` has no log of its own.
- No case holds two Front chats of one session across a restart.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix in 0.16: a chat that is not the default chat names its log by its `chatId` | Softov, 2026-11-23: "Fix in 0.16" | 01 |
| The log of such a chat is at `logs/chats/<session id>/<chatId>.jsonl`, out of the top of `logs/` that `logIds` reads | (defaulted: the problem's fix keeps these logs out of the folder the session list reads, and a folder per session keeps one delete for a session) | 01 |
| The default chat keeps `logs/<session id>.jsonl`, and existing logs are not moved | (defaulted: the default chat's log is already right; a shared log written before the fix stays mixed) | 01 |

## Proposed architecture

- **Data flow** - `bot-chat`'s open picks the folder and the id. The default chat keeps `logsOf(...)` and its session id. A chat with `chatId` takes `join(logsOf(...), 'chats', encodeURIComponent(sessionId))` and its `chatId`.
- **Event flow** - unchanged.
- **State flow** - one file per chat; `logIds` sees only the default chats' files.
- **Layer responsibilities** - bot: names the log, as today.
- **Source-of-truth files** - [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a chat names its log by its chat id](task-01-a-chat-names-its-log-by-chat-id.md) | done | - |

## Risks and tradeoffs

- A bot that already ran with `threadSessions` off has mixed turns in its session log. They stay there; the fix stops new mixing.
- A session removed with its folder must also take `logs/chats/<session id>/`. Task 01 checks the removal path in `plugin.ts`.

## Resume state

- **Done so far:** task 01, on 2026-11-23. [implemented.md](implemented.md) holds the checks.
- **Next action:** none. `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** `start.resume` is the default chat's backend id after a restart; a chat with a `chatId` must use the `chatId`, not `resume`.

## Final verification checklist

- [ ] Two Front chats of one session each open on their own turns after a restart.
- [ ] `logIds` lists the session once, from its default chat's log.
- [ ] `npx vitest run packages/bot/test` passes.
