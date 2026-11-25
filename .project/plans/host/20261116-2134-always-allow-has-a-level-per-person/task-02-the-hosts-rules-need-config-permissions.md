---
title: The host's rules need config:permissions
status: done
depends: [task-01-a-person-keeps-rules-of-their-own.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/access/users.ts#L178-L183](../../../../packages/sdk/src/access/users.ts#L178-L183) - the `config` subject"
  - "[code://packages/sdk/src/host/gate.ts#L313-L319](../../../../packages/sdk/src/host/gate.ts#L313-L319) - the push gate"
  - "[code://packages/sdk/src/host/chatactions.ts#L2273-L2290](../../../../packages/sdk/src/host/chatactions.ts#L2273-L2290) - the host grant"
---

## Objective

Only a person with `config:permissions` writes the host's rules, by an answer or by a push.
A host grant from anyone else stays in the session.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:178-183` - `permissions` joins the `config` subject's operations, in the `write` group.
- `UPDATE: packages/sdk/src/host/gate.ts:313-319` - a push that names only `permissions` needs `config:permissions`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:2273-2290` - a host grant checks the answerer's grant, and writes the session's rules without it.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - the push cases.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the answer cases.

## Steps

1. Add `permissions` to the `config` subject, in its `write` group, with a one-line description.
2. In the gate, ask `config:permissions` for a push whose only key is `permissions`.
3. Keep `config:change` for a push that names any other key beside it.
4. In the answer, check that the answerer holds `config:permissions` before a host grant.
5. Without it, write the grant's rules to the session's `permissions`, as a session grant.
6. On a host with no users file, write a host grant as today.

## Validation

- `users-gate-dispatch.test.ts`: the gate refuses a member's push of `permissions`, and applies an admin's.
- `host-permissions.test.ts`: a member's host grant lands in the session, and the root's `permissions` stay as they were.
- `host-permissions.test.ts`: an admin's host grant lands in the root's `permissions`.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- A push that names `permissions` beside other keys needs `config:permissions` as well as `config:change`. Step 3 asked for `config:change` alone, which let a role with `config:change` and not `config:permissions` write the rules.
- `pushedPermissionsNeed` in `gate.ts` adds the grant, and the dispatch check asks for each grant.
- The cases are in `users-gate-dispatch.test.ts` and `host-permissions.test.ts`.
