---
title: The docs name the levels and the grant
status: done
depends: [task-02-the-hosts-rules-need-config-permissions.md, task-04-the-question-offers-the-approved-levels.md]
layer: docs
refs:
  - "[code://docs/server/REMOTE.md#L87](../../../../docs/server/REMOTE.md#L87) - `config:write` where the code checks `config:change`"
  - "[code://docs/server/RUN.md#L64](../../../../docs/server/RUN.md#L64) - the same name"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the 0.15.0 notes"
---

## Objective

The docs name the three levels, the grant `config:permissions` and the person store, and use `config:change` where the code checks it.

## Files

- `UPDATE: docs/server/USERS.md` - the levels of an Always Allow, and `config:permissions` among the grants.
- `UPDATE: docs/sdk/USERS.md` - `config:permissions` in the `config` subject's table.
- `UPDATE: docs/server/REMOTE.md:87` - `config:change` in place of `config:write` where the code checks it.
- `UPDATE: docs/server/RUN.md:64` - the same correction.
- `UPDATE: docs/updates/v0_15.md` - an item under *Upgrading* of 0.15.0.

## Steps

1. Read each place the docs say `config:write`, and keep it where the code checks `config:write`.
2. Write `config:change` where the code checks `config:change`.
3. Write the three levels in `docs/server/USERS.md`, with who gets each.
4. Add the note item: an Always Allow from a person without `config:permissions` now holds for that person only.
5. Say in the same item that a member's older rules stay in the host's `permissions`.
6. Run `pnpm build` and `pnpm docs:build`, and fix each broken link.

## Validation

- `pnpm docs:build` passes.
- `rg -n "config:write" docs` names only places where the code checks `config:write`.

## Resume

Built on 2026-11-16, awaiting review.

- `REMOTE.md:87` and `RUN.md:64` stay as they are. The `config` command and `x-ahpd/restart` check `config:write`.
- The root push is `config:change` in `docs/sdk/USERS.md`, `AUTHENTICATION.md` and `TOOLS.md`. `HOST.md` has a row for `config:permissions`.
- The new section in `docs/server/USERS.md` is *Who an Always Allow is for*.
