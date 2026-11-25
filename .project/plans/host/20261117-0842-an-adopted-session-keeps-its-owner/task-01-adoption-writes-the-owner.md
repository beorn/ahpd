---
title: Adoption writes the owner
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L2258-L2261](../../../../packages/sdk/src/host/lifecycle.ts#L2258-L2261) - the adoption"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2618-L2624](../../../../packages/sdk/src/host/lifecycle.ts#L2618-L2624) - how `openSession` writes an owner"
---

## Objective

A person's turn that adopts an external session writes that person as its owner, when the session has none.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts:2258-2261` - write the owner before the adoption.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` - the adoption owner case.
- `UPDATE: docs/sdk/SESSIONS.md:100` - one sentence on the owner of an adopted session.

## Steps

1. Before `ctx.adoptExternalSession`, read whether the session is external with `ctx.isExternal`.
2. Call `kept.setOwner` with `who` when the session is external, `who` exists and `kept.owner` answers nothing.
3. Keep the sender's principal in `principals` under `who`, as `openSession` does.
4. Copy the test from `/github/ahpd.worktrees/external-owner` into `host-catalogue.test.ts`.
5. Add a case: an adopted session that already has an owner keeps it.
6. Add a sentence to `docs/sdk/SESSIONS.md`: the person whose turn adopts a session becomes its owner.

## Validation

- `host-catalogue.test.ts`: on a host with users, the session ana adopts has the owner `user:ana`, as the one she made.
- `host-catalogue.test.ts`: an adopted session that has an owner keeps it.
- `host-catalogue.test.ts`: the existing adoption cases pass unchanged.
- Run the sdk and computer suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
The two cases share `signedIn`, a host with users where ana is signed in and `older` is listed external.
The kept-owner case writes `user:bo` once the host has opened the session.
In this fake, a record that starts with a provider and the external mark is not opened at all.
