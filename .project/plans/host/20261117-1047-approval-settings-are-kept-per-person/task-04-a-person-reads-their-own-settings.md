---
title: A person reads their own settings back
status: done
depends: [task-01-a-push-keeps-the-keys-for-its-person.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L790-L835](../../../../packages/sdk/src/host/root.ts#L790-L835) - `rootFor`, the root's state for one connection"
  - "[code://packages/sdk/src/host.ts#L752-L840](../../../../packages/sdk/src/host.ts#L752-L840) - `projectActionForClient`, an action for one connection"
---

## Objective

A person's connection reads their own values of the approval keys in the root, each key marked as a person's.
A change of the host's value does not replace them.

## Files

- `UPDATE: packages/sdk/src/access/personrules.ts` - `SCOPE_MARK`, the schema mark.
- `UPDATE: packages/sdk/src/host/root.ts:790-835` - `rootFor` puts the person's values in place of the host's, and marks the keys.
- `UPDATE: packages/sdk/src/host.ts:752-840` - `projectActionForClient` keeps a person's own values in a `root/configChanged` sent to them.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the served values, the mark, and a change of the host's value.
- `UPDATE: docs/server/USERS.md` - what a person's window reads back.
- `UPDATE: docs/sdk/HOST.md:162` - the served values and the mark.

## Steps

1. Add `SCOPE_MARK`, `x-ahpd-scope`, beside `APPROVAL_KEYS`.
2. In `rootFor`, for a person's connection on a host with users, put their `settings` over the values.
3. Mark each of `APPROVAL_KEYS` in that connection's schema with `x-ahpd-scope: "person"`.
4. In `projectActionForClient`, put the person's own values over a `root/configChanged` that names one of their keys, or replaces.
5. Leave the host's own connection and a host with no users as they are.

## Validation

- `root-config.test.ts`: ana reads her pushed rules back with the mark, and bo and the host's connection read none.
- `root-config.test.ts`: the host's connection pushes new rules; ana gets hers, and bo the host's.
- Run the sdk and computer suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
A person's push of only the approval keys gets no echo, as a push that changes nothing gets none.
Every action on the root goes through `dispatch`, which reduces it into the one root state.
So an echo to one person would put their values in everybody's root.
The pushing window keeps its own values, and the person's other windows read them at their next connect.
The mark is added per connection, because `vscodeRootProperties` copies VS Code's declarations as they are.
