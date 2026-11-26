---
title: A blank clears a field
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/record.ts#L296-L355](../../../../packages/bot/src/record.ts#L296-L355) - `checkRecord`"
  - "[code://packages/bot/src/provider.ts#L655-L690](../../../../packages/bot/src/provider.ts#L655-L690) - the put, which checks the agent and builds the record"
---

## Objective

An edit with a blank field clears it. An edit that leaves the field out keeps it.

## Files

- `UPDATE: packages/bot/src/record.ts:296-355` - the seven fields tell a blank from an absent value.
- `UPDATE: packages/bot/test` - the cases.
- `UPDATE: docs/plugins/BOTS.md` - what a blank means in an edit.
- `UPDATE: docs/updates/v0_16.md` - the Upgrading line.
- `UPDATE: .project/specs/bots.md` - the scenario.

## Steps

1. Add a helper that returns the existing value for an absent field, and nothing for a blank one.
2. Use it for `description`, `instructions`, `template`, `provider`, `model`, `preset` and `computer`.
3. Keep the type checks of each field.
4. Check that cleared instructions reach `AGENTS.md`, because a read answers them from that file.
5. Write the docs, the notes and the spec.

## Validation

- A case for each field: blank clears, and absent keeps.
- A case: a make with a blank makes a bot without the field.
- A case: after a blank `instructions`, a read answers none, and the other text of `AGENTS.md` stays.

## Resume
