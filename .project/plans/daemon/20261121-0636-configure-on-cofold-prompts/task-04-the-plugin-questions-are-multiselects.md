---
title: the plugin questions are multiselects
status: done
depends: [task-03-the-configure-tests-keep-their-meaning.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/configure.ts#L281-L305](../../../../packages/server/src/commands/configure.ts#L281-L305) - the backend and other-plugin questions, now one multiselect each"
  - "[code://packages/server/src/commands/configure.ts#L335-L375](../../../../packages/server/src/commands/configure.ts#L335-L375) - the found-agent questions, now one multiselect, and the pi removal kept as a yes or no"
  - "[code://packages/server/src/ask.ts](../../../../packages/server/src/ask.ts) - `multiselect`, which the three questions call"
---

## Objective

A person picks the backends, the other plugins and the agents found in one list each, with the current set ticked, instead of answering one yes or no per item.

## Files

- `UPDATE: packages/server/src/ask.ts` - add `multiselect`, which draws the cofold multiselect with its hints.
- `UPDATE: packages/server/src/commands/configure.ts` - replace the three per-item loops with one multiselect each, and keep the pi removal as a yes or no.
- `UPDATE: packages/server/test/server-configure.test.ts` - answer the lists by Enter or Space, and check the new labels.
- `UPDATE: packages/server/test/server-ask.test.ts` - test that Space ticks and unticks, and that Enter keeps the set.

## Steps

1. Add `multiselect` to `ask.ts`, which takes the items, the ticked values and the terminal.
2. Replace the backend loop in `configure()` with one multiselect over the backends, ticked where the file names them or on a first run Claude is.
3. Replace the other-plugin loop with one multiselect, ticked the same way as before.
4. Replace the found-agent loop with one multiselect over the agents not already configured, all ticked.
5. Keep the pi removal as its own yes or no.
6. Update the configure tests to answer each list by Enter, or by Space to untick.
7. Run `pnpm typecheck` and the server tests.

## Validation

- `pnpm typecheck` exits 0.
- The server suite passes.
- A pty run shows one list per group, with the current set ticked.
