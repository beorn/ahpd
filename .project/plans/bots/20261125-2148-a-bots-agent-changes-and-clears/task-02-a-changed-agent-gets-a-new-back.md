---
title: A changed agent gets a new Back
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/wake.ts#L439-L478](../../../../packages/bot/src/wake.ts#L439-L478) - `backOf`"
  - "[code://packages/bot/src/names.ts#L178-L212](../../../../packages/bot/src/names.ts#L178-L212) - the rows to mirror"
  - "[code://packages/bot/package.json](../../../../packages/bot/package.json) - the options schema and the `secondSession` option to mirror"
---

## Objective

The next message after an agent or model change starts a new Back, unless `agentChange` is `keep`.

## Files

- `UPDATE: packages/bot/src/names.ts` - the rows that keep the current Back of each Front.
- `UPDATE: packages/bot/src/wake.ts:439-478` - compare the row with the record.
- `UPDATE: packages/bot/src/plugin.ts` - the option and the rows.
- `UPDATE: packages/bot/package.json` - `agentChange` in the options schema.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the cases.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the restart case.
- `UPDATE: docs/plugins/BOTS.md` - the option and the rule.
- `UPDATE: docs/updates/v0_16.md` - the entry and its Upgrading line.
- `UPDATE: .project/specs/bots.md` - the scenario of the Back.

## Steps

1. Keep a row for each Front chat with its Back chat, agent and model.
2. Write the row when a Back starts, and when the wake finds a Back with no row.
3. Make `backOf` use the Back of the row when that chat is still in the session.
4. Continue the old Back when the option is `keep`, or when a turn runs or waits on it.
5. Else start a new Back when the named agent or model differs.
6. Keep the check of the owner's agent before all of it.
7. Keep one start at a time for each Front.
8. Write the docs, the notes and the spec.

## Validation

- A case each: agent changed, model changed, nothing changed, and `keep`.
- A case each: no row, old Back busy, and a row of a chat that is gone.
- A case: after a restart the new Back is the one that gets the message.
- A case: a post from the old Back still lands in the Front.

## Resume
