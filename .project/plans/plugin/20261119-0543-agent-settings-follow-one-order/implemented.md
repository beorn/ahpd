---
title: Agent settings follow one order - implemented
date: 2026-11-19
refs:
  - git://f926befca
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts)"
  - "[code://packages/agent-acp/src/session/opening.ts](../../../../packages/agent-acp/src/session/opening.ts)"
---

The four agent plugins list their options and an agent's fields by purpose, in the order of the plan's *Field order*. Claude works in the host's paths and has a default model. A host's Claude agent sets its own config folder in a machine. An acp agent says a machine that could not start it in one short sentence.

## What was built

- Each plugin's `package.json` - the options in the order of *Field order*; Claude's `paths` is gone and `model` is first.
- [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts) - `RECORD_FIELDS` in order, with `portFailures` after `machine`.
- [`code://packages/agent-acp/src/session/opening.ts`](../../../../packages/agent-acp/src/session/opening.ts) - `askMachine`, which says a refused machine by `portFailures`, used by a session and a terminal.
- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) - `FORM_ORDER`, the order `kindSchema` draws, and `computerConfigDir` on a record.
- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - the host's paths, a warning for `paths`, the plugin's `model`, and the record's `computerConfigDir`, host only.
- [`code://packages/agent-cofold/src/plugin.ts`](../../../../packages/agent-cofold/src/plugin.ts) - `memory` is a plugin option only.
- [`code://packages/agent-pi/src/plugin.ts`](../../../../packages/agent-pi/src/plugin.ts) - `env` after `hostTools` on a record.
- The four READMEs list their tables in the forms' order, and the 0.15.0 notes say each change.

## Verified

- An order case per plugin, for its options and its record.
- Claude cases: the `paths` warning, the plugin's model and the record's, and the record's config folder.
- acp cases: the short sentence with the raw message in the log, and the raw message with `message`.
- The suites passed one at a time: acp 379, claude 686, cofold 325, pi 279, sdk 4956, server 1982, computer 633.
- #385 passed `check` and `check-windows` on its first run, 44472095314, and merged as `f926befca` on 2026-11-19.

## Departures from the plan

- Claude's record order is `FORM_ORDER` in `kindSchema`. `DECLARED` keeps its order, which is the order the options merge in.
- `portFailures` covers a session and a terminal. A listing's failure goes to the log only, so it keeps the raw message.
- A cofold record keeps `catalogueTimeoutMs`, which the first table left out.

## Left for later

- The checks by hand of the plan's *Final verification checklist*, in [deferred.md](deferred.md).
