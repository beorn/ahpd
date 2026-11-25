---
title: A push keeps the approval keys for its person
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/access/personrules.ts](../../../../packages/sdk/src/access/personrules.ts) - the person store"
  - "[code://packages/sdk/src/host/gate.ts#L324-L334](../../../../packages/sdk/src/host/gate.ts#L324-L334) - `dispatchNeeds`"
  - "[code://packages/sdk/src/host/actions.ts#L328-L420](../../../../packages/sdk/src/host/actions.ts#L328-L420) - the root push"
---

## Objective

On a host with users, a person's push of the three approval keys is kept in their own file, and a member may push them.

## Files

- `UPDATE: packages/sdk/src/access/personrules.ts` - `settings(person)` and `keep(person, values)` for the three keys.
- `UPDATE: packages/sdk/src/host/gate.ts:324-334` - a push of only the approval keys needs a sign-in, or `config:change` for a new regex key.
- `UPDATE: packages/sdk/src/host/actions.ts:328-420` - the approval keys of a person's push go to the person store.
- `UPDATE: packages/sdk/test/person-rules.test.ts` - the store cases.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - the gate cases.

## Steps

1. Add `APPROVAL_KEYS`: `terminalAutoApproveRules`, `terminalAutoApproveEnabled` and `editAutoApprovePatterns`.
2. Add `settings(person)` to `PersonRules`, answering the approval keys the person's file holds.
3. Add `keep(person, values)`, writing the keys beside `permissions`, and removing a key whose value is `null`.
4. Write `keep` with a temporary name and a rename, at mode 0600, as `grant` writes.
5. In `dispatchNeeds`, answer `undefined` for a push whose keys are all approval keys.
6. Answer `config:change` there when `terminalAutoApproveRules` holds a `/.../` key that `DEFAULT_TERMINAL_AUTO_APPROVE_RULES` lacks.
7. In the root push from a person on a host with users, take the approval keys out of `config`.
8. Write them with `keep` for that person, and apply the rest to the root as today.
9. Answer a push that held only approval keys with nothing on the root, as a push that changes nothing.

## Validation

- `person-rules.test.ts`: `keep` writes the keys beside `permissions`, and `settings` reads them back.
- `person-rules.test.ts`: a `null` value removes the key, and `permissions` stays.
- `users-gate-dispatch.test.ts`: the host applies a member's push of the approval keys, and refuses one with a new regex key.
- `users-gate-dispatch.test.ts`: an admin's push of the approval keys leaves the root's values as they were.
- `users-gate-dispatch.test.ts`: a push that also names another key still needs `config:change`.
- Run the sdk, computer and server suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
A host with users and no `personPermissionsDir` refuses a person's push of the approval keys.
It has nowhere to keep them, and setting them for everybody is the problem this plan fixes.
The rest of a push beside them is applied without them, so a VS Code connect push keeps its trust.
`wire.test.ts` echoes every key of VS Code's connect push but these three on a host with users, and lists `x-ahpd-scope` among its widenings.
`commandparser.test.ts` and `agent-acp-ports.test.ts` give their hosts a person folder, since they push rules on a host with users.
`grant` now keeps the other keys of a person's file, where it wrote only `permissions` before.
`autoapproval.test.ts` and `root-config.test.ts` were written for one host value, and now read each person's own.
