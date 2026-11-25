---
title: the read-before-write and dangling-link switches
status: done
depends: [task-04-the-tool-table-and-tools-042.md]
layer: "agent-cofold"
refs:
  - npm://@cofold/tools@0.4.2 - `files({ requireRead })` and the dangling-link write
  - "[code://packages/agent-cofold/src/tools.ts#L1-L40](../../../../packages/agent-cofold/src/tools.ts#L1-L40) - where the file tools are built"
---

## Objective

ahpd uses cofold's read-before-write switch where a harness asks for it, and gets the dangling-link write without its own code.

## Files

- `UPDATE: packages/agent-cofold/src/tools.ts` - pass `requireRead` through where the harness sets it, and keep the default on.

## Steps

1. Read the 0.4.2 `files` options in `node_modules/@cofold/tools/dist/files.d.ts`.
2. Find whether ahpd has a setting for the read-before-write rule today; if not, keep the default and record that.
3. If there is a setting, pass it as `requireRead`.
4. Run `pnpm exec vitest run packages/agent-cofold`.

## Validation

- The default is on. The agent-cofold tests refuse a write without a read.

## Result

No change. `requireRead` and the dangling-link write are in `@cofold/tools` 0.4.1. `toolsOf` in `capabilities.ts` passes `files.requireRead` through and keeps the rule on by default, and `agent-cofold-options.test.ts` covers both.
