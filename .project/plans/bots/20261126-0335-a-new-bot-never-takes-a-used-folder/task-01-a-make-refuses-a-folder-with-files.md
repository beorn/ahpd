---
title: A make refuses a folder with files
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/provider.ts#L489-L505](../../../../packages/bot/src/provider.ts#L489-L505) - `workspaceFor`"
  - "[code://packages/bot/src/provider.ts#L710-L722](../../../../packages/bot/src/provider.ts#L710-L722) - the folder write of a make"
---

## Objective

A make that names no folder is refused when its default folder has files. A make that names the folder keeps working as today.

## Files

- `UPDATE: packages/bot/src/provider.ts:489-505` - `workspaceFor` refuses a default folder that has files, on a make of a bot that is not on a computer.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the cases.
- `UPDATE: docs/plugins/BOTS.md` - when a make is refused for its folder, and how to name a folder to take it.
- `UPDATE: docs/updates/v0_16.md` - an Upgrading line and a Bots line.
- `UPDATE: .project/specs/bots.md` - the scenario "A bot owns one folder".

## Steps

1. In `workspaceFor`, refuse a make that names no folder when `<root>/<slug>` has any entry.
2. Use `ALREADY_EXISTS` with a message that names the folder and says to name it to take it.
3. Skip the check for a bot on a computer and for an edit.
4. Keep the refusal before any read or write of the folder.
5. Write the docs, the notes and the spec.

## Validation

- A case: the host refuses a make whose default folder holds an `AGENTS.md`, with `-32010`.
- The same case: the file stays unchanged.
- A case: a make that names that folder writes its parts into the file, as today.
- A case: a make with an empty default folder succeeds.
- A case: an edit of a bot whose folder has files succeeds.
- `pnpm typecheck` and the bot and webhook suites pass.

## Resume

Built on 2026-11-26, as [implemented.md](implemented.md) says.
