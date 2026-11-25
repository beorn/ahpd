---
title: The work and control pages
status: todo
depends: [task-01-the-guide-and-its-running-pages.md]
layer: "docs"
refs:
  - "[code://docs/plugins/COMPUTERS.md](../../../../docs/plugins/COMPUTERS.md) - machines"
  - "[code://docs/sdk/POLICY.md](../../../../docs/sdk/POLICY.md) - limits and who may use what"
---

## Objective

The guide has the four pages about work and control: machines, automation, access and spending.

## Files

- `CREATE: docs/guide/MACHINES.md` - isolated machines, from `plugins/COMPUTERS.md` and `plugins/CONTAINERS.md`.
- `CREATE: docs/guide/AUTOMATION.md` - schedules and webhooks, from `sdk/AUTOMATIONS.md` and `plugins/WEBHOOKS.md`.
- `CREATE: docs/guide/ACCESS.md` - users, teams, roles and permissions, from `server/USERS.md`, `sdk/USERS.md` and `sdk/AUTHENTICATION.md`.
- `CREATE: docs/guide/SPENDING.md` - usage and limits, from `server/USAGE.md`, `sdk/USAGE.md` and `sdk/POLICY.md`.
- `UPDATE: docs/.vitepress/config.mts:22` - the four pages in the Guide group.
- `UPDATE: docs/README.md` - one line for each page in the `guide` section.

## Steps

1. Write each page in the four parts of the plan's *Page shape*.
2. Check each fact against the code and the page it links.
3. Add each page to the Guide group and to the `guide` section.

## Validation

- `pnpm docs:build` passes.
- Each link on the four pages resolves in the built site.
- Softov reads the four pages.

## Resume

