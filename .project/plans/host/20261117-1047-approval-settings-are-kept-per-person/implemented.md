---
title: The approval settings are kept per person - implemented
date: 2026-11-18
refs:
  - git://7334b1464 - the merge of #367
---

On a host with users, the settings that decide what runs or is written without a question are kept per person.
A push from a person's window changes their own sessions, and no other person's.
A member's window applies its settings to their own sessions too.

## What was built

- [`code://packages/sdk/src/access/personrules.ts`](../../../../packages/sdk/src/access/personrules.ts) - `settings(person)` and `keep(person, values)` for the three keys.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - a push of only the approval keys needs a sign-in, or `config:change` for a new regex key.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the approval keys of a person's push go to the person store.
- [`code://packages/sdk/test/person-rules.test.ts`](../../../../packages/sdk/test/person-rules.test.ts) - the store cases.
- [`code://packages/sdk/test/users-gate-dispatch.test.ts`](../../../../packages/sdk/test/users-gate-dispatch.test.ts) - the gate cases.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `personSettingsOf(session)`, beside `personRulesOf`.
- [`code://packages/sdk/test/host-permissions.test.ts`](../../../../packages/sdk/test/host-permissions.test.ts) - the cases of carol, alice and bob.
- [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md) - *Terminal rules* names the person's value.
- [`code://docs/server/USERS.md`](../../../../docs/server/USERS.md) - a section on whose approval settings apply.
- [`code://docs/sdk/HOST.md`](../../../../docs/sdk/HOST.md) - the three keys as the exception to one value for the whole host.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one *Upgrading* item.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `rootFor` puts the person's values in place of the host's, and marks the keys.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `projectActionForClient` keeps a person's own values in a `root/configChanged` sent to them.
- [`code://packages/sdk/test/root-config.test.ts`](../../../../packages/sdk/test/root-config.test.ts) - the served values, the mark, and a change of the host's value.

## Verified

- On the test daemon, carol pushes `{"rm": true}`, and `rm` still asks in alice's session.
- The same push makes `rm` run with no question in carol's own session.
- bob, a member, pushes rules, and they apply in bob's sessions.
- The sdk, computer and server suites pass.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #367.

## Departures from the plan

- A host with users and no `personPermissionsDir` refuses a person's push of the approval keys.
- It has nowhere to keep them, and setting them for everybody is the problem this plan fixes.
- The rest of a push beside them is applied without them, so a VS Code connect push keeps its trust.
- `wire.test.ts` echoes every key of VS Code's connect push but these three on a host with users, and lists `x-ahpd-scope` among its widenings.
- `commandparser.test.ts` and `agent-acp-ports.test.ts` give their hosts a person folder, since they push rules on a host with users.
- `grant` now keeps the other keys of a person's file, where it wrote only `permissions` before.
- `autoapproval.test.ts` and `root-config.test.ts` were written for one host value, and now read each person's own.
- `spawn.ts` is the only reader of the three keys in every package.
- `docs/sdk/AHP.md` says the same in its `root/configChanged` row, beyond the task's files.
- A person's push of only the approval keys gets no echo, as a push that changes nothing gets none.
- Every action on the root goes through `dispatch`, which reduces it into the one root state.
- So an echo to one person would put their values in everybody's root.
- The pushing window keeps its own values, and the person's other windows read them at their next connect.
- The mark is added per connection, because `vscodeRootProperties` copies VS Code's declarations as they are.

## Left for later

- Nothing.
