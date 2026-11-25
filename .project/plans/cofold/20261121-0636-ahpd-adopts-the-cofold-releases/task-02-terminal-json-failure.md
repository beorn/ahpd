---
title: the terminal JSON failure
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/main.ts#L22-L23](../../../../packages/server/src/main.ts#L22-L23) - the `failureOf` and `writeFailure` imports from `@cofold/terminal`"
---

## Objective

The `--json` failure line comes from `@cofold/terminal` 0.4.0 or later, and ahpd keeps it when it moves to 0.5.0.

## Files

- `UPDATE: packages/server/src/main.ts` - no change; ahpd already calls the library's failure writer.

## Steps

1. Read `packages/server/src/main.ts` lines 22 and 23 and confirm the imports.
2. Run the server suite after the terminal bump, as the configure plan's task 03 does, and confirm it passes.

## Validation

- The server suite passes with `@cofold/terminal` 0.5.0 (1982 tests, 2026-11-21).
