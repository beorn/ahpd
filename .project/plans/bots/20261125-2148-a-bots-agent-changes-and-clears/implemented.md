---
title: A bot's agent changes and its fields clear - implemented
date: 2026-11-25
---

## What exists now

- An edit tells a blank from an absent field, for the seven fields a bot may be without.
- The rows in `<configDir>/bots/<slug>/backs/` name the current Back of each Front, its agent and its model.
- A message after an agent or model change starts a new Back, or continues the old one with `agentChange` at `keep`.

## Departures

- When the Back of a row is gone, a new Back starts. An older Back of the same Front is not taken up again.

## Verified

- `bot-record.test.ts` and `bot-provider.test.ts` hold the blanks, with the text of `AGENTS.md` that stays.
- `bot-wake.test.ts` holds the change, `keep`, the wait, a Back with no row and a Back that is gone.
- `bot-chat.test.ts` holds an open talk on a real host: an edit to another agent, and a blank back to the default.
- Not held by a case of its own: a whole daemon restart between the edit and the message. The row's read in a new store is held.
- Not held by a case of its own: a post from the old Back after a new one started.
