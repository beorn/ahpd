---
title: A new bot never takes a used folder - implemented
date: 2026-11-26
refs:
  - git://8d2d20806 - main the build started from
  - "[code://packages/bot/src/provider.ts#L497-L526](../../../../packages/bot/src/provider.ts#L497-L526) - `workspaceFor`, with the check on the folder"
  - "[code://packages/bot/src/provider.ts#L23-L31](../../../../packages/bot/src/provider.ts#L23-L31) - `hasFiles`"
---

A make of a bot that names no folder is refused with `-32010` when `<root>/<slug>` already has files.
The refusal comes before any read or write of the folder, so the files stay as they were.
A make that names the folder takes it, as before, and writes its parts into an `AGENTS.md` there.
An empty folder, an edit, and a bot on a computer are not checked.

## What was built

- [`code://packages/bot/src/provider.ts#L497-L526`](../../../../packages/bot/src/provider.ts#L497-L526) - `workspaceFor` refuses a default folder with files on a make.
- [`code://packages/bot/src/provider.ts#L23-L31`](../../../../packages/bot/src/provider.ts#L23-L31) - `hasFiles`, which answers false for a missing or unreadable folder.
- [`code://packages/bot/test/bot-provider.test.ts`](../../../../packages/bot/test/bot-provider.test.ts) - two new cases, and two cases that now name their folder.
- [`docs/plugins/BOTS.md`](../../../../docs/plugins/BOTS.md), [`docs/updates/v0_16.md`](../../../../docs/updates/v0_16.md) and [`specs/bots.md`](../../../specs/bots.md) - the refusal, an Upgrading line and a Bots line.

## Verified

- The bot suite runs 288 of 288, the webhook suite 124 of 124, and the server suite 2006 of 2006.
- `pnpm typecheck` and `pnpm docs:build` pass.

## Departures from the plan

- Two cases made a bot over an `AGENTS.md` in the default folder: the file left by a crash, and a file this host cannot read. Both now name the folder, which is how a make takes it.
- After a crash between the file write and the record write, a retry with the same slug is refused. A client moves to the next slug, and the old folder stays.

## Left for later

- The check with two real hosts that share one root, and the ahpw form moving to the next slug, are by hand and not done.
