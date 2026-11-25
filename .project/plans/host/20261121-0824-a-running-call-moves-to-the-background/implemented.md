---
title: A running call moves to the background - implemented
date: 2026-11-21
refs:
  - git://eb832a04f - the merge of PR #407 that holds the host plan's work
  - git://9003a0a1c - the brief this plan covers
  - "[code://packages/sdk/src/host/background.ts](../../../../packages/sdk/src/host/background.ts) - the movable calls per chat, the `_meta` keys and `withMeta`"
  - "[code://packages/sdk/src/tools/shell.ts](../../../../packages/sdk/src/tools/shell.ts) - the sync command offers its call and moves on `x-ahpd/backgroundToolCall`"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the `x-ahpd/backgroundToolCall` handler"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - `shellToolsFor`, the default for pi and cofold"
---

A running tool call can move to the background through `x-ahpd/backgroundToolCall`.
The call carries `ahpd.backgroundToolCall` while it can move, and `ahpd.backgroundWork` once its work is a row.
The host shell moves a sync command, and pi and cofold get the host shell by default.

## What was built

- [`code://packages/sdk/src/host/background.ts`](../../../../packages/sdk/src/host/background.ts) - a movable call per chat, and `withMeta`, which lays the two keys on the start, ready, content-changed and complete actions.
- [`code://packages/sdk/src/tools/shell.ts`](../../../../packages/sdk/src/tools/shell.ts) - a sync command offers its call, and a move turns it into an `async` command with a row, a stop and a turn at its end.
- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - `x-ahpd/backgroundToolCall { chat, toolCallId }` answers `{ backgrounded }`, and requires `chat:send` in the gate table.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the host shell is on for pi and cofold unless the root config says otherwise.
- [`code://packages/agent-cofold/test/agent-cofold-tools.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - `shell_exec` is removed when the host shell is in use.
- Docs in `docs/sdk/AHP.md` and `docs/sdk/TERMINALS.md`.

## Verified

- Full `pnpm test:unit` on the branch, with the worktree's own `pnpm install --frozen-lockfile`: 538 files, 9468 tests passed, 32 skipped.
- Each changed package typechecks.
- PR #407 passed CI on every check before it merged.

## Departures from the plan

- `x-ahpd/backgroundToolCall` is not listed in `ahpd.methods`. Listing it put a key on every handshake and broke ten tests, so a client sees support through the flag on the call.
- The provider reports the row before its call completes, so the completion always carries the row link.
- The shell tool does not withdraw its offer when the command finishes, because the completion removes the flag anyway.

## Left for later

- Whether VS Code sends `enableCustomTerminalTool: false` on its own. If it does, a VS Code window turns the host shell off for pi and cofold.
- Movable tools beyond the shell, for pi and ACP.
- The "Run in background" button in ahpw and ahpc, which reads the two keys and calls the method.
- A subagent in another session moving a call.
