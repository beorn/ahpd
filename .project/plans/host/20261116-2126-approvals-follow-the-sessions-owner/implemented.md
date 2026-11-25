---
title: A session's approvals follow its owner - implemented
date: 2026-11-18
refs:
  - git://9018eba72 - the merge of #360
---

On a host with users, a person's turn gets a session's approvals only when that person owns the session.
The approvals are the terminal rules, the edit patterns, the allow rules, the reads inside the working folders, `globalAutoApproveEnabled`, the session's `autoApprove` and `workspaceTrust`.
A turn nobody sent gets the owner's approvals while `unattendedAutoApprove` is on, the default, and none while it is off.
A host with no users file is unchanged.

## What was built

- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `toolReady` reads whose turn it is and leaves out the approvals for another person's turn.
- [`code://packages/sdk/test/host-permissions.test.ts`](../../../../packages/sdk/test/host-permissions.test.ts) - the cases of another person's turn.
- [`code://packages/sdk/test/host-trust.test.ts`](../../../../packages/sdk/test/host-trust.test.ts) - the cases of another person's start.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `unattendedAutoApprove?: boolean` on `HostOptions`, with its doc comment.
- [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts) - the setting, file only, a boolean, `true` by default.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon hands it to `createHost`.
- [`code://packages/server/test/config-check.test.ts`](../../../../packages/server/test/config-check.test.ts) - the setting's value check.
- [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md) - a row for `unattendedAutoApprove`.
- [`code://docs/server/USERS.md`](../../../../docs/server/USERS.md) - one paragraph on whose turns get a session's approvals.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - an item under *Upgrading* of 0.15.0.

## Verified

- The sdk suite and the computer suite pass, one at a time.
- On the test daemon, dave's `rm` in alice's `autoApprove` session asks, and alice's own does not.
- With `unattendedAutoApprove` off, an automation's `pnpm ls` asks; with it on, it runs.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #360.

## Departures from the plan

- An automation's turn carries its owner as its sender, so the sender alone cannot say "nobody sent it". The rule reads the turn's message origin: `user` is a person's turn, and any other kind is unattended.
- `toolReady` skips `getAutoApproval` for a turn with no approvals, in place of building the approval without each one.
- The case that asserted the old behaviour in `host-permissions.test.ts` is replaced by four cases.
- In `host-trust.test.ts`, another person's start now reads no trust.
- In `autoapproval.test.ts`, a turn from somebody other than the owner, in a session read back from the store, now asks.
- The key is also on the file's `Config` type, which `config-check.test.ts` holds equal to the schema.
- `host-trust.test.ts` covers an automation's trust with the setting on and off.

## Left for later

- Nothing.
