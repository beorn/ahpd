---
title: The auto-approve restriction is a person's own
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/access/personrules.ts#L13](../../../../packages/sdk/src/access/personrules.ts#L13) - `APPROVAL_KEYS`"
  - "[code://packages/sdk/src/host/spawn.ts#L636-L652](../../../../packages/sdk/src/host/spawn.ts#L636-L652) - the two reads of the host's value"
  - "[code://docs/server/USERS.md#L114](../../../../docs/server/USERS.md#L114) - *Whose approval settings apply*"
---

## Objective

On a host with users, a push of `autoApprovePolicyRestricted` is kept for the person who pushed it, and a session reads its owner's value.

## Files

- `UPDATE: packages/sdk/src/access/personrules.ts:13` - `autoApprovePolicyRestricted` joins `APPROVAL_KEYS`.
- `UPDATE: packages/sdk/src/host/spawn.ts:636-652` - both reads of the key go through `setting`.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the cases of a person's restriction.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the key carries the `person` mark.
- `UPDATE: docs/server/USERS.md:114` - the fourth key in *Whose approval settings apply*.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. Add `autoApprovePolicyRestricted` to `APPROVAL_KEYS` in `personrules.ts`.
2. In `spawn.ts`, read `sessionAutoApprove`'s restriction with `setting('autoApprovePolicyRestricted') === true`.
3. Read `allowAll`'s restriction the same way.
4. Add a case: alice's push of `true` makes her `autoApprove` session ask.
5. Add a case: carol's push of `false` leaves alice's session asking, and carol's own session runs.
6. Add a case: a session whose owner keeps no value reads the host's value.
7. Add a case to `root-config.test.ts`: the key's schema carries `x-ahpd-scope: "person"` on a host with users.
8. Name the fourth key in *Whose approval settings apply* in `USERS.md`.
9. Say in that section that a window pushes the key from its policy.
10. Add a line to the unreleased notes, under *Upgrading*.

## Validation

- The cases of steps 4 to 7 pass, and fail without steps 1 to 3.
- The sdk suite and the computer suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

