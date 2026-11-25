---
title: A person keeps rules of their own
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/access/permissionrules.ts#L17-L30](../../../../packages/sdk/src/access/permissionrules.ts#L17-L30) - the scopes and the option ids"
  - "[code://packages/sdk/src/host/chatactions.ts#L2273-L2290](../../../../packages/sdk/src/host/chatactions.ts#L2273-L2290) - where an answer writes a grant"
  - "[code://packages/sdk/src/host/spawn.ts#L572](../../../../packages/sdk/src/host/spawn.ts#L572) - where a question reads the rules"
---

## Objective

A grant has a third scope, `person`. An answer with it writes the answerer's rules to `permissions/<person>.json`.
A question reads the session's rules, then the session owner's person rules, then the host's.

## Files

- `UPDATE: packages/sdk/src/access/permissionrules.ts:17-30` - `PermissionGrantScope` gains `person`, with its option id prefix.
- `CREATE: packages/sdk/src/access/personrules.ts` - the store: read and write one person's `permissions`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:2273-2290` - a `person` grant writes the answerer's store.
- `UPDATE: packages/sdk/src/host/spawn.ts:572` - the question reads the owner's person rules between the two.
- `UPDATE: packages/sdk/src/types/host.ts` - the option that names the store's folder.
- `CREATE: packages/sdk/test/person-rules.test.ts` - the store's cases.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the reading order.

## Steps

1. Add `person` to `PermissionGrantScope`, with the prefix `allow-person-rules:`.
2. Write the store: a JSON file per person id under the configured folder, holding `allow` and `deny`.
3. Write a file with a temporary name and a rename, so a crash leaves the old file whole.
4. Give `createHost` the folder, and give the daemon `<configDir>/permissions`.
5. In the answer, write a `person` grant to the store of the person who answered.
6. Ignore a `person` grant on a host with no users file.
7. In the question, read the session owner's person rules between the session's and the host's.

## Validation

- `person-rules.test.ts`: a grant adds its rules once, and a second grant keeps the first.
- `person-rules.test.ts`: a person with no file has no rules.
- `host-permissions.test.ts`: bob's person rule approves `rm` in bob's session and not in alice's.
- `host-permissions.test.ts`: a deny in a person's rules refuses the call.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- The store is `access/personrules.ts`. A file is `<folder>/<id>.json`, with the id URI-encoded, written with mode 0600.
- Only a `user:` owner has a person store. The host's own owner holds every grant, so it gets the host level.
- The host option is `personPermissionsDir`, and the daemon sets it to `<configDir>/permissions`.
- Task 03 makes the table's deny list win, and the table denies `rm`. So the reading cases use `make`, not `rm`.
