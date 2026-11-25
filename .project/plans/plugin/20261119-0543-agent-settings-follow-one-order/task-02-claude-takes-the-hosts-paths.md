---
title: Claude takes the host's paths, a default model and a record's config folder
status: done
depends: [task-01-the-fields-follow-one-order.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L69-L87](../../../../packages/agent-claude/src/plugin.ts#L69-L87) - `defaultsOf`, where `paths` is read"
  - "[code://packages/agent-claude/src/plugin.ts#L140-L159](../../../../packages/agent-claude/src/plugin.ts#L140-L159) - `open`, where the record's `model` reaches the backend"
  - "[code://packages/agent-cofold/src/plugin.ts#L225](../../../../packages/agent-cofold/src/plugin.ts#L225) - cofold's `hostOnly` with `computerConfigDir`, the pattern"
---

## Objective

The claude plugin has no `paths`, and Claude works in the host's paths. The plugin's `model` is the model of a record that names none. A host record may set `computerConfigDir` over the plugin's.

## Files

- `UPDATE: packages/agent-claude/package.json` - `paths` leaves; `model` comes first.
- `UPDATE: packages/agent-claude/src/plugin.ts:69-87` - `defaultsOf` takes `host.paths`, logs a warning when `paths` is set, and reads `model`.
- `UPDATE: packages/agent-claude/src/plugin.ts:120-159` - `open` takes the record's `model`, or the plugin's; `computerConfigDir` from the record over the plugin's; `hostOnly` takes `computerConfigDir`.
- `UPDATE: packages/agent-claude/src/options.ts:533-563` - `OF_A_VARIANT` gains `computerConfigDir`, after `sandbox`.
- `UPDATE: packages/agent-claude/i18n/pt.json` - the text of `model` and of the record's `computerConfigDir`.
- `UPDATE: packages/agent-claude/i18n/es.json` - the same text in Spanish.
- `UPDATE: packages/agent-claude/README.md` - the options table and the example without `paths`, with `model`.
- `UPDATE: packages/agent-claude/test/agent-claude-options-schema.test.ts` - the order cases with `model` and `computerConfigDir`.
- `UPDATE: packages/agent-claude/test/agent-claude-plugin-switch.test.ts` - cases of the warning, the default model and the record's config folder.
- `UPDATE: docs/updates/v0_15.md` - a line in *Upgrading* for `paths`, and one for the rest.

## Steps

1. Remove `paths` from the claude `optionsSchema`, and add `model` as its first field.
2. In `defaultsOf`, take `host.paths` and nothing else.
3. Log a warning when the options set `paths`: it is not read, and Claude works in the host's paths.
4. In `open`, pass the record's `model`, or the plugin's `model` when the record names none.
5. Add `computerConfigDir` to the record fields after `sandbox`, with the plugin's schema and `hostOnly`.
6. In `open`, pass the record's `computerConfigDir` over the plugin's.
7. Add the pt and es text of both new fields.
8. Update the README's options table and its example.
9. Add the cases and the notes lines.

## Validation

- A case: options with `paths` load, Claude takes the host's paths, and the log holds the warning.
- A case: a record with no `model` opens on the plugin's `model`, and a record's own `model` wins.
- A case: a host record's `computerConfigDir` reaches the machine need, and a person's record cannot set it.
- The claude suite, the sdk suite and the computer suite pass, one at a time.

## Resume
