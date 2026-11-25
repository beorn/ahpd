---
title: The fields of every agent form follow one order
status: done
depends: []
layer: "agent-acp, agent-claude, agent-cofold, agent-pi"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L96-L198](../../../../packages/agent-acp/src/plugin.ts#L96-L198) - `RECORD_FIELDS`, reordered"
  - "[code://packages/agent-claude/src/options.ts#L492-L563](../../../../packages/agent-claude/src/options.ts#L492-L563) - `DECLARED` and `OF_A_VARIANT`, reordered"
  - "[code://packages/agent-cofold/src/plugin.ts#L89](../../../../packages/agent-cofold/src/plugin.ts#L89) - `NOT_A_RECORD` gains `memory`"
---

## Objective

Each plugin's options and each record's fields follow the plan's *Field order*. The fields of tasks 02 and 03 come later. cofold's `memory` is a plugin option only.

## Files

- `UPDATE: packages/agent-acp/package.json` - the order of `optionsSchema.properties`.
- `UPDATE: packages/agent-acp/src/plugin.ts:96-198` - the order of `RECORD_FIELDS`.
- `UPDATE: packages/agent-claude/package.json` - the order of `optionsSchema.properties`.
- `UPDATE: packages/agent-claude/src/options.ts:492-563` - the order of `DECLARED` and `OF_A_VARIANT`, so `kindSchema` draws the claude record's order.
- `UPDATE: packages/agent-cofold/package.json` - the order of `optionsSchema.properties`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:89` - `NOT_A_RECORD` takes `memory`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:225` - `hostOnly` drops `memory`.
- `UPDATE: packages/agent-pi/package.json` - the order of `optionsSchema.properties`.
- `UPDATE: packages/agent-pi/src/plugin.ts:124-141` - `env` goes after `hostTools`, before `projectTrust`.
- `UPDATE: packages/agent-acp/test/agent-acp-options.test.ts` - a case of each acp form's order.
- `UPDATE: packages/agent-claude/test/agent-claude-options-schema.test.ts` - a case of each claude form's order.
- `UPDATE: packages/agent-cofold/test/agent-cofold-options.test.ts` - a case of each cofold form's order, and of `memory` refused on a record.
- `UPDATE: packages/agent-pi/test/agent-pi-options.test.ts` - a case of each pi form's order.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. Reorder each `optionsSchema.properties` to the plan's *Field order*.
2. Reorder acp's `RECORD_FIELDS` to the acp record's row.
3. Reorder claude's `DECLARED` and `OF_A_VARIANT`, so `kindSchema` lists the claude record's row.
4. Add `memory` to cofold's `NOT_A_RECORD`, and remove it from cofold's `hostOnly`.
5. Build pi's record schema so `env` comes after `hostTools`.
6. Add a case per plugin that reads the keys of its options and of its `kindSchema`, and expects its rows.
7. Leave out the fields that tasks 02 and 03 add from those cases.
8. Add a line to the unreleased notes.

## Validation

- Each order case passes, and fails when two fields swap.
- The cofold schema refuses a record that sets `memory`.
- The suites of the four agent packages pass, one at a time, as HANDOFF *Tests* says.

## Resume
