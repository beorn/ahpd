---
title: The docs say whose turns are approved
status: done
depends: [task-01-the-owners-turns-get-the-approvals.md, task-02-a-setting-for-turns-nobody-sent.md]
layer: docs
refs:
  - "[code://docs/server/CONFIGURE.md#L123](../../../../docs/server/CONFIGURE.md#L123) - the row beside which the setting goes"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the 0.15.0 notes"
---

## Objective

The configuration reference names `unattendedAutoApprove`, and the 0.15 notes say whose turns get a session's approvals on a host with users.

## Files

- `UPDATE: docs/server/CONFIGURE.md:123` - a row for `unattendedAutoApprove`.
- `UPDATE: docs/server/USERS.md` - one paragraph on whose turns get a session's approvals.
- `UPDATE: docs/updates/v0_15.md` - an item under *Upgrading* of 0.15.0.

## Steps

1. Add the row for `unattendedAutoApprove`: file only, `true` by default, and what it covers.
2. Name the approvals in the row: rules, edit patterns, allow rules, reads in the working folders, auto-approve and trust.
3. Add to `USERS.md` that another person's turn in a session gets none of the owner's approvals.
4. Add the item to *Upgrading*: on a host with users, a turn sent into another person's session now asks.
5. Say in the same item how to make an automation ask: set `unattendedAutoApprove` to `false`.
6. Run `pnpm build` and `pnpm docs:build`, and fix each broken link.

## Validation

- `pnpm docs:build` passes.
- The row and the item read in their files.

## Resume

Built on 2026-11-16, awaiting review. The section *Whose turns are approved* in `docs/server/USERS.md` holds the rule, and the row and the note link to it.

