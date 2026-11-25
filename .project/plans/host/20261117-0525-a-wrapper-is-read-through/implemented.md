---
title: A wrapper command is read through to the command it runs - implemented
date: 2026-11-18
refs:
  - git://cdc16cabf - the merge of #363
---

A wrapper command runs the command after it, so the rules judge that command.
`command rm -rf x` is denied as `rm -rf x` is, whatever allow rule names `command`.
`timeout 60 npm test` is approved by `Shell(npm test)`.
No grant names a wrapper, so a saved rule such as `Shell(command *)` approves nothing that its inner command does not.

## What was built

- [`code://packages/sdk/src/access/commandautoapprover.ts`](../../../../packages/sdk/src/access/commandautoapprover.ts) - read each command through `innerCommand` before it is matched.
- [`code://packages/sdk/src/host/permissions.ts`](../../../../packages/sdk/src/host/permissions.ts) - a `permissions` deny rule also matches the inner command.
- [`code://packages/sdk/test/commandautoapprover.test.ts`](../../../../packages/sdk/test/commandautoapprover.test.ts) - the wrapper cases.
- [`code://packages/sdk/test/host-permissions.test.ts`](../../../../packages/sdk/test/host-permissions.test.ts) - a question on a wrapped command offers the inner command's key.
- [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md) - one paragraph on wrappers in *Terminal rules*.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one *Upgrading* item.

## Verified

- With `Shell(command *)` in a person's rules, `command rm -rf x` asks and offers no grant, on the test daemon.
- With `Shell(npm test)`, `timeout 60 npm test` runs with no question.
- A question on `timeout 60 make` offers `make`, never `timeout`.
- The sdk, computer and agent-acp suites pass.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #363.

## Departures from the plan

- `innerCommand` reads each wrapper by the grammar in `WRAPPERS`, and the wrapper names join `NEVER_AUTO_APPROVE_COMMANDS`.
- The plan did not know that `isDeniedByPermissions` also matches the written command, so `command make` evaded a person's `Shell(make *)` deny.
- It now matches the inner command too, and a case fails without that change.
- A quoted or expanded word before the command makes it unread, so `exec -a "npm test" rm` cannot pass for `npm test`.

## Left for later

- Nothing.
