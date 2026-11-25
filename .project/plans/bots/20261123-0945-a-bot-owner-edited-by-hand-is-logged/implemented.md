---
title: A bot owner edited by hand is taken and logged - implemented
date: 2026-11-23
refs:
  - "[code://packages/bot/src/store.ts](../../../../packages/bot/src/store.ts) - `take`, the store's answer to a hand edit"
---

The bot's file is the truth for its owner. A hand edit of `owner` on a running daemon is taken, as a restart already took it. The daemon log says the change once, and the bot's `updatedAt` moves, so a client sees it.

## What was built

- [`code://packages/bot/src/store.ts`](../../../../packages/bot/src/store.ts) - `take` takes a new owner, says `bots/<id> owner changed from <old> to <new> by an edit of its file`, and writes the new `updatedAt` back as the store's own write.

## Verified

- `bot-store.test.ts`: the owner case now checks the new owner, the one line, the moved `updatedAt` in the cache and the record, and one change heard. It fails without the change.
- `bot-store.test.ts`: a new case, a store that loads after the edit takes the file's owner and says nothing.
- The bot suite: 16 files, 275 tests passed. `pnpm typecheck` passes.

## Departures from the plan

- The workspace check now runs before the owner check, so a file that changes both is refused for its workspace and nothing is taken.

## Left for later

- None.
