---
title: acp says a machine that could not start it in a short sentence
status: done
depends: [task-01-the-fields-follow-one-order.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/opening.ts#L286-L301](../../../../packages/agent-acp/src/session/opening.ts#L286-L301) - a session's machine command"
  - "[code://packages/agent-acp/src/session/handlers.ts#L491-L500](../../../../packages/agent-acp/src/session/handlers.ts#L491-L500) - a terminal's machine command"
  - "[code://packages/agent-acp/src/catalog.ts#L418](../../../../packages/agent-acp/src/catalog.ts#L418) - a listing's machine command"
  - "[code://packages/agent-claude/src/options.ts#L365-L377](../../../../packages/agent-claude/src/options.ts#L365-L377) - Claude's `portFailures`, copied"
---

## Objective

An acp record has `portFailures`, `spawn` or `message`, with `spawn` the default. With `spawn`, a machine that cannot start the agent is said as `The agent could not start in computer://<id>.`, and the raw message goes to the daemon's log. With `message`, the raw message is the failure, as today.

## Files

- `UPDATE: packages/agent-acp/src/plugin.ts:96-198` - `RECORD_FIELDS` gains `portFailures` after `machine`, with Claude's schema and its own text.
- `UPDATE: packages/agent-acp/src/plugin.ts:353-430` - the record's options read `portFailures`.
- `UPDATE: packages/agent-acp/src/session/opening.ts:286-301` - a refused machine command is said by `portFailures`.
- `UPDATE: packages/agent-acp/src/session/handlers.ts:491-500` - the same for a terminal.
- `UPDATE: packages/agent-acp/src/catalog.ts:418` - the same for a listing.
- `UPDATE: packages/agent-acp/i18n/pt.json` - the text of `portFailures`.
- `UPDATE: packages/agent-acp/i18n/es.json` - the same text in Spanish.
- `UPDATE: packages/agent-acp/README.md` - `portFailures` in the record's fields.
- `UPDATE: packages/agent-acp/test/agent-acp-machine.test.ts` - cases of both values.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. Add `portFailures` to `RECORD_FIELDS` after `machine`, with the values `spawn` and `message`.
2. Read it into the record's options, with `spawn` when the record names none.
3. Write one function that says a refused machine command by `portFailures`, and logs the raw message.
4. Call it at the three places that ask a machine for its command.
5. Add the pt and es text, the README line and the notes line.

## Validation

- A case: with no `portFailures`, a refused machine command fails with the short sentence. The log holds the raw message.
- A case: with `message`, the session fails with the raw message.
- The order case of task 01 lists `portFailures` after `machine`.
- The acp suite and the computer suite pass, one at a time.

## Resume
