---
title: The docs say what false means
status: done
depends: [task-02-claude-asks-about-a-named-host-tool.md, task-03-pi-and-cofold-ask-in-every-mode.md]
layer: docs
refs:
  - "[code://docs/server/CONFIGURE.md#L123-L124](../../../../docs/server/CONFIGURE.md#L123-L124) - the rows of `eligibleForAutoApproval` and `managedRules`"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the 0.15.0 notes"
---

## Objective

The configuration reference says that under `checked` a tool set `false` asks in every backend and mode, and under `handed` the runtimes decide.

## Files

- `UPDATE: docs/server/CONFIGURE.md:123-124` - the two rows.
- `UPDATE: docs/plugins/PLUGINS.md` - `Start.alwaysAsks`, beside the other fields of `Start`.
- `UPDATE: docs/updates/v0_15.md` - one item under a heading of 0.15.0.

## Steps

1. Say in the `eligibleForAutoApproval` row that under `checked` a tool set `false` asks in every backend and mode.
2. Say in the same row that under `handed` each runtime reads the rule, as VS Code's do.
3. Add `Start.alwaysAsks` beside `Start.managedSettings` in `docs/plugins/PLUGINS.md`, near line 412.
4. Add the note item: a tool set `false` asks in Claude, pi and cofold in every mode.
5. Run `pnpm build` and `pnpm docs:build`, and fix each broken link.

## Validation

- `pnpm docs:build` passes.

## Resume

Built on 2026-11-16, awaiting review.

- The note item is under *Upgrading* of 0.15.0.
