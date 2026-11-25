---
title: The docs say whose settings apply
status: done
depends: [task-02-a-question-reads-the-owners-settings.md]
layer: "docs"
refs:
  - "[code://docs/server/CONFIGURE.md#L150](../../../../docs/server/CONFIGURE.md#L150) - *Terminal rules*"
  - "[code://docs/server/USERS.md#L96](../../../../docs/server/USERS.md#L96) - *Who an Always Allow is for*"
  - "[code://docs/sdk/HOST.md#L162](../../../../docs/sdk/HOST.md#L162) - the root config is one value for the whole host"
---

## Objective

The docs say that on a host with users each person's window settings apply to their own sessions.

## Files

- `UPDATE: docs/server/CONFIGURE.md:150` - *Terminal rules* names the person's value.
- `UPDATE: docs/server/USERS.md:96` - a section on whose approval settings apply.
- `UPDATE: docs/sdk/HOST.md:162` - the three keys as the exception to one value for the whole host.
- `UPDATE: docs/updates/v0_15.md:20` - one *Upgrading* item.

## Steps

1. Say in *Terminal rules* that on a host with users, a person's push changes only their own sessions.
2. Add a section to `USERS.md` on the three keys, the regex rule, and the host's value.
3. Name the three keys in `HOST.md` as kept per person, with `workspaceTrust` still one host value.
4. Add an *Upgrading* item: an admin's push no longer sets other people's rules; read the root's value once.

## Validation

- Read the four files for an em dash or a hard wrap.
- The `users.test.ts` case of the docs table passes.

## Resume

Built on 2026-11-17.
`docs/sdk/AHP.md` says the same in its `root/configChanged` row, beyond the task's files.
