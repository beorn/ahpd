---
title: Configure sets up policies and people - implemented
date: 2026-11-18
refs:
  - git://f718cd99f - the merge of #372
  - git://fadc39469 - the merge of #373
---

`ahpd configure` sets up the first person and the policies, so that a person can start a session with no hand-written policy.
On 2026-11-17 Softov's first session as a person was refused, because the store held no `agent` row and no `computer` row.
The run ends with the commands to run next, as `kubeadm init` does.

## What was built

- [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts) - `roleNames()` on `fileUsers`, and one helper for the two places that put the defined roles together.
- [`code://packages/sdk/src/types/users.ts`](../../../../packages/sdk/src/types/users.ts) - `roleNames?()` on `Users`, the roles a host defines, sorted.
- [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts) - the person question, the `users` key, `added` on `Configured`, and the closing lines.
- [`code://packages/server/test/server-configure.test.ts`](../../../../packages/server/test/server-configure.test.ts) - the cases of this task.
- [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md) - what `configure` asks about a person, and what it prints at the end.
- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) - `policiesPath(dir = configDir())`.
- [`code://docs/sdk/POLICY.md`](../../../../docs/sdk/POLICY.md) - a session needs an `agent` row and a `computer` row, and no computer means `host`.

## Verified

- The server suite passes, and `check` and `check-windows` are green.
- A first `ahpd configure` with Enter at every question writes what it wrote before this plan, and adds no person and no row.
- On the test daemon on 39200, a `member` with the check on and the starter rows starts a Claude session.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #372 and #373.

## Departures from the plan

- `roleNames` is optional on `Users`, because the test stand-ins of `Users` in other packages do not have it.
- A row with a `from` or an `until` does not count as one that allows every person, since it is not active at all times.

## Left for later

- Nothing.
