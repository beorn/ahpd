---
title: the configure tests keep their meaning
status: done
depends: [task-02-ask-and-confirm-call-the-cofold-prompts.md]
layer: "server"
refs:
  - "[code://packages/server/test/server-ask.test.ts](../../../../packages/server/test/server-ask.test.ts) - the question tests, which answer through streams"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the configure flow tests"
---

## Objective

The existing question and configure tests pass on the cofold prompts, and a test pins the cancel path.

## Files

- `UPDATE: packages/server/test/server-ask.test.ts` - the answers are sent as keys (`\r` for Enter, `y` for yes) instead of lines, where a test feeds a line the prompts would read as keys.
- `UPDATE: packages/server/test/server-configure.test.ts` - only the answer feeding changes, if a test sends a typed number for a select.

## Steps

1. Run `pnpm exec vitest run packages/server/test/server-ask.test.ts packages/server/test/server-configure.test.ts` and record which tests fail.
2. For each failing test, change only how its answers are sent. Keep what they are.
3. Add one test that sends Escape through a question and expects the cancel error.
4. Run `pnpm exec vitest run packages/server/test` and confirm the whole server suite passes.

## Validation

- `pnpm exec vitest run packages/server/test` exits 0.
- Each test that was removed is named in *implemented.md*.
