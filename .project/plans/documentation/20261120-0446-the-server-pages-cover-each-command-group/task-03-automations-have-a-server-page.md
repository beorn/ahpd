---
title: Automations have a server page
status: done
depends: []
layer: "docs"
refs:
  - "[code://packages/server/src/commands/automation.ts](../../../../packages/server/src/commands/automation.ts) - `ahpd automation`"
  - "[code://docs/sdk/AUTOMATIONS.md#L199-L355](../../../../docs/sdk/AUTOMATIONS.md#L199-L355) - where an automation is kept, its commands and its files"
---

## Objective

`docs/server/AUTOMATIONS.md` says what an automation is for a person who runs the daemon, where its files are, and what each `ahpd automation` command does.

## Files

- `CREATE: docs/server/AUTOMATIONS.md` - automations, their files, and `list`, `export` and `import`.
- `UPDATE: docs/sdk/AUTOMATIONS.md:231` - *Commands* links `server/AUTOMATIONS.md` for the CLI.
- `UPDATE: docs/.vitepress/config.mts:35` - `AUTOMATIONS.md` in the Server group.
- `UPDATE: docs/README.md` - `AUTOMATIONS.md` in the `server` table.

## Steps

1. Write what an automation is: work the host starts on a schedule or an event, with no client connected.
2. Write where its files are, and the `automations` and `unownedAutomations` settings.
3. Write the command table: `automation list`, `export <id>`, `import <file>`.
4. Say that `export` writes ahpd's file, or VS Code's with `--vscode`.
5. Say that `import` makes a new automation, switched off, in `--folder`.
6. Link `sdk/AUTOMATIONS.md` for the triggers, the runs and the file format.
7. Add the page to the sidebar and the index, and link it from `sdk/AUTOMATIONS.md`.

## Validation

- Each command's line matches its `--help`.
- `pnpm docs:build` passes.

## Resume

Written on 2026-11-20. The `list` paragraph and its example moved from `sdk/AUTOMATIONS.md` to the server page. The example names `/work/project` and `Europe/Berlin` in place of a person's folder and zone.

