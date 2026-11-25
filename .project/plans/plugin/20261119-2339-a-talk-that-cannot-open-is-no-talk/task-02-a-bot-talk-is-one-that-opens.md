---
title: A bot talk is one that opens
status: done
depends: [task-01-the-host-says-whether-a-session-opens.md]
layer: "bot"
refs:
  - "[code://packages/bot/src/talks.ts#L30-L127](../../../../packages/bot/src/talks.ts#L30-L127) - `TalkSeams.kept`, and `of`, `all` and `fromLogs`, which ask it"
  - "[code://packages/bot/src/plugin.ts#L555-L562](../../../../packages/bot/src/plugin.ts#L555-L562) - the seam wired to `host.sessionKept`"
  - "[code://packages/bot/test/bot-provider.test.ts#L1376-L1404](../../../../packages/bot/test/bot-provider.test.ts#L1376-L1404) - the cases of one talk for each bot and person"
---

## Objective

A bot counts a session as a person's talk only where the host can open it.
A talk with no message, after a restart, is no talk: a read of the bot answers none, and Open chat makes a new one.

## Files

- `UPDATE: packages/bot/src/talks.ts:30-127` - `TalkSeams.kept` becomes `opens`, and `of`, `all` and `fromLogs` ask it.
- `UPDATE: packages/bot/src/plugin.ts:555-562` - the seam calls `host.sessionOpens`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the case of a talk that does not open after a restart.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the `Talks` and seams it builds, with `opens`.
- `UPDATE: docs/plugins/BOTS.md` - a talk that does not open is not kept.
- `UPDATE: docs/updates/v0_15.md` - a line under *Bots*, and one under *Plugins and connectors* for `sessionOpens`.

## Steps

1. Rename `TalkSeams.kept` to `opens`, with a comment that says a store row outlives a session with no turn.
2. Make `of`, `all` and `fromLogs` ask `opens`.
3. Wire `opens` to `host.sessionOpens` in `plugin.ts`.
4. Keep `host.sessionKept` in the reopen of the talks a restart left open.
5. Add the case, the docs line and the notes lines.

## Validation

- Check this case in `bot-provider.test.ts`:
  - A second host over the same store and folder holds the row of a talk with no message.
  - A read of the bot answers no `session` for its person.
  - A create for that person succeeds.
  - The host refuses a second create, and names the new talk.
- The bot, sdk, computer, push and webhook suites pass, one at a time.
- On the test daemon, Solar's talk from 2026-11-19 is not answered, and Open chat makes a new one.

## Resume

Built on 2026-11-19. The case writes the row a restart leaves into one host's store and Front rows, in place of a second host.
It fails with the seam wired to `sessionKept`, and passes with `sessionOpens`.
Suites: bot 273, push 58, webhook 124, sdk 4961.
The computer suite fails one case, `finds an adopted container again`, which times out on main too and is in `problems/computer-cases-time-out-on-a-busy-machine.md`.

