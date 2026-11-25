---
title: Always Allow has a level for one person - implemented
date: 2026-11-18
refs:
  - git://3d753db39 - the merge of #362
---

On a host with users, a person's "Always Allow" answer holds for that person, not for every session on the host.
A person with the new grant `config:permissions` may still write the host's rules, under a label that says they apply to everyone.
The terminal table's deny list wins over any allow rule again.
An option allows every command for the rest of one session.

## What was built

- [`code://packages/sdk/src/access/permissionrules.ts`](../../../../packages/sdk/src/access/permissionrules.ts) - `PermissionGrantScope` gains `person`, with its option id prefix.
- [`code://packages/sdk/src/access/personrules.ts`](../../../../packages/sdk/src/access/personrules.ts) - the store: read and write one person's `permissions`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a `person` grant writes the answerer's store.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the question reads the owner's person rules between the two.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - the option that names the store's folder.
- [`code://packages/sdk/test/person-rules.test.ts`](../../../../packages/sdk/test/person-rules.test.ts) - the store's cases.
- [`code://packages/sdk/test/host-permissions.test.ts`](../../../../packages/sdk/test/host-permissions.test.ts) - the reading order.
- [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts) - `permissions` joins the `config` subject's operations, in the `write` group.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - a push that names only `permissions` needs `config:permissions`.
- [`code://packages/sdk/test/users-gate-dispatch.test.ts`](../../../../packages/sdk/test/users-gate-dispatch.test.ts) - the push cases.
- [`code://packages/sdk/src/access/commandautoapprover.ts`](../../../../packages/sdk/src/access/commandautoapprover.ts) - the table's deny rules are read before an allow from a permission rule.
- [`code://packages/sdk/test/commandautoapprover.test.ts`](../../../../packages/sdk/test/commandautoapprover.test.ts) - the order's cases.
- [`code://packages/sdk/src/host/permissions.ts`](../../../../packages/sdk/src/host/permissions.ts) - `grantOption` takes the `person` scope and the labels.
- [`code://docs/server/USERS.md`](../../../../docs/server/USERS.md) - the levels of an Always Allow, and `config:permissions` among the grants.
- [`code://docs/sdk/USERS.md`](../../../../docs/sdk/USERS.md) - `config:permissions` in the `config` subject's table.
- [`code://docs/server/REMOTE.md`](../../../../docs/server/REMOTE.md) - `config:change` in place of `config:write` where the code checks it.
- [`code://docs/server/RUN.md`](../../../../docs/server/RUN.md) - the same correction.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - an item under *Upgrading* of 0.15.0.

## Verified

- The sdk suite and the computer suite pass, one at a time.
- On the test daemon, bob's "for Me" answer leaves alice's `make` asking, and alice's "for Everyone" answer approves it in bob's session. The table denies `rm`, so `rm` asks for both.
- A member's push of `permissions` is refused.
- Each label matches the approved mockup.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #362.

## Departures from the plan

- The store is `access/personrules.ts`. A file is `<folder>/<id>.json`, with the id URI-encoded, written with mode 0600.
- Only a `user:` owner has a person store. The host's own owner holds every grant, so it gets the host level.
- The host option is `personPermissionsDir`, and the daemon sets it to `<configDir>/permissions`.
- Task 03 makes the table's deny list win, and the table denies `rm`. So the reading cases use `make`, not `rm`.
- A push that names `permissions` beside other keys needs `config:permissions` as well as `config:change`. Step 3 asked for `config:change` alone, which let a role with `config:change` and not `config:permissions` write the rules.
- `pushedPermissionsNeed` in `gate.ts` adds the grant, and the dispatch check asks for each grant.
- The cases are in `users-gate-dispatch.test.ts` and `host-permissions.test.ts`.
- The case uses a classifier that allows `find`, in `commandautoapprover.test.ts`.
- A line that the table denies gets no grant, only Allow Once, Allow All and Skip (Softov, 2026-11-16).
- The host level is offered when this process knows that the session's owner holds `config:permissions`. An owner not seen since a restart is not offered it.
- Allow All is offered on shell questions only, as its label says commands. The managed lock also takes it away.
- On a host with users, the answer that turns on Allow All needs `session:configure`, as any change of the session's config does.
- Each level is a group of its own, and Skip is in the group after the last one.
- The two cases in `host-input.test.ts` that list the options of a host with no users file now include Allow All.
- `agent-acp-rule.test.ts` reads Skip as the last option, in whichever group it falls.
- `REMOTE.md:87` and `RUN.md:64` stay as they are. The `config` command and `x-ahpd/restart` check `config:write`.
- The root push is `config:change` in `docs/sdk/USERS.md`, `AUTHENTICATION.md` and `TOOLS.md`. `HOST.md` has a row for `config:permissions`.
- The new section in `docs/server/USERS.md` is *Who an Always Allow is for*.

## Left for later

- Nothing.
