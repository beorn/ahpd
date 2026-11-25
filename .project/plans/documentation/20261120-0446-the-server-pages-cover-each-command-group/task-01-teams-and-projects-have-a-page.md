---
title: Teams and projects have a page
status: done
depends: []
layer: "docs"
refs:
  - "[code://packages/server/src/commands/teams.ts](../../../../packages/server/src/commands/teams.ts) - `ahpd team` and `ahpd project`"
  - "[code://docs/sdk/USERS.md](../../../../docs/sdk/USERS.md) - memberships, and what a team and a project are charged with"
---

## Objective

`docs/server/TEAMS.md` says what a team and a project are for, and what each `ahpd team` and `ahpd project` command does.

## Files

- `CREATE: docs/server/TEAMS.md` - teams and projects, and their six commands.
- `UPDATE: docs/server/USERS.md:13-36` - the `team` row links `TEAMS.md`.
- `UPDATE: docs/.vitepress/config.mts:35` - `TEAMS.md` after Users in the Server group.
- `UPDATE: docs/README.md` - `TEAMS.md` after `USERS.md` in the `server` table.

## Steps

1. Write what a team and a project are for: memberships, the scope of work, usage pools, tokens and vault names.
2. Write the command table: `team list`, `team add`, `team rm`, and the same three for `project`.
3. Say that `add` sets the title of an existing one.
4. Say that the host refuses `rm` while a membership names it.
5. Link `sdk/USERS.md`, `USAGE.md` and `VAULT.md` for the detail.
6. Add the page to the sidebar and the index, and link it from `USERS.md`.

## Validation

- Each command's line matches `ahpd team <command> --help`.
- `pnpm docs:build` passes.

## Resume

Written on 2026-11-20. The memberships section names `user member` and `user primary`, which `USERS.md` also lists, as the commands that use a team.

