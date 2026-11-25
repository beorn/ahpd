---
title: The documents say it
status: done
depends:
  - task-01-the-two-schemes-are-read-only.md
layer: docs
refs:
  - "[code://docs/plugins/BOTS.md#L280](../../../../docs/plugins/BOTS.md#L280) - says the resource methods keep working"
---

## Objective

The documents name the commands as the one way to change a bot or a device, and the removal is ready for the release notes.

## Files

- `UPDATE: docs/plugins/BOTS.md` - the sentence on `resourceWrite` and `resourceDelete` says they are refused.
- `UPDATE: docs/plugins/push.md` - a device is registered with the command.

## Steps

1. Correct the two pages.
2. Write the breaking change in `implemented.md`, for `v0_16.md`.

## Validation

- `pnpm docs:build` passes.

## Resume

Done 2026-11-24. See [implemented.md](implemented.md).
