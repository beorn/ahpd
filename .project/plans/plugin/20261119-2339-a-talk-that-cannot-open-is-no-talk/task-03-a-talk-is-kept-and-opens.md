---
title: A talk is kept and opens
status: done
depends: [task-02-a-bot-talk-is-one-that-opens.md]
layer: "bot"
refs:
  - "[code://packages/bot/src/talks.ts#L95-L135](../../../../packages/bot/src/talks.ts#L95-L135) - `botTalks`, with `talk` asking both checks"
  - "[code://packages/bot/test/bot-provider.test.ts](../../../../packages/bot/test/bot-provider.test.ts) - the case of an old log with no record"
---

## Objective

A bot counts a session as a talk only when the store keeps it with its config and the host can open it.
A talk taken from an old log is told to the catalogue, so a read and a refusal name the same talk.

## Files

- `UPDATE: packages/bot/src/talks.ts` - `TalkSeams.kept` comes back beside `opens`, and `talk` asks both.
- `UPDATE: packages/bot/src/plugin.ts` - `kept` is wired to `host.sessionKept`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the case of an old log whose session has no record.
- `UPDATE: docs/plugins/BOTS.md` - when a talk counts.
- `UPDATE: docs/updates/v0_15.md` - the old log in the *Bots* line.

## Steps

1. Add `kept` to `TalkSeams` again, with a comment that says a talk's config names its bot.
2. Add `talk(uri)`, which asks `kept` and `opens`, and use it in `of`, `all` and `fromLogs`.
3. Call `onKeep` in `fromLogs` after it writes the row.
4. Add the case and the docs lines.

## Validation

- Check this case in `bot-provider.test.ts`:
  - A Front log holds a turn, and the store keeps no record of its session.
  - A create succeeds, and the host refuses a second one naming the new talk.
- The case fails with `opens` alone, and passes with both checks.
- The bot suite passes.

## Resume

Built on 2026-11-19, after #386 took Ember's talk from 2026-11-13 as Softov's.
That session had a log, so it opened, and its record held no config, so a message logged `There is no bot .` and woke no Back.
