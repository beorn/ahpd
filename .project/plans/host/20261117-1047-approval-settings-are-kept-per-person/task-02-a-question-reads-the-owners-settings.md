---
title: A question reads the owner's settings
status: done
depends: [task-01-a-push-keeps-the-keys-for-its-person.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L594-L629](../../../../packages/sdk/src/host/spawn.ts#L594-L629) - the three reads from the root"
  - "[code://packages/sdk/src/host/spawn.ts#L553-L556](../../../../packages/sdk/src/host/spawn.ts#L553-L556) - `personRulesOf`"
---

## Objective

A question in a session answers by its owner's approval settings where they keep one, and by the host's otherwise.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:553-556` - `personSettingsOf(session)`, beside `personRulesOf`.
- `UPDATE: packages/sdk/src/host/spawn.ts:594-629` - each of the three reads takes the owner's value first.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the cases of carol, alice and bob.

## Steps

1. Add `personSettingsOf(session)`, reading `personRules.settings` for the person who owns the session.
2. Read `terminalAutoApproveRules` from it before `ctx.rootConfig`.
3. Read `editAutoApprovePatterns` and `terminalAutoApproveEnabled` the same way.
4. Keep the host's value for a session with no owner, and for a `root:` owner.

## Validation

- `host-permissions.test.ts`: carol pushes `{"rm": true}`; `rm` asks in alice's session and runs in carol's.
- `host-permissions.test.ts`: bob, a member, pushes `{"make": true}`, and `make` runs in bob's session.
- `host-permissions.test.ts`: an owner's `terminalAutoApproveEnabled: false` makes their table answer nothing.
- `host-permissions.test.ts`: a host with no users reads the root's value as before.
- Run the sdk and computer suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`spawn.ts` is the only reader of the three keys in every package.
