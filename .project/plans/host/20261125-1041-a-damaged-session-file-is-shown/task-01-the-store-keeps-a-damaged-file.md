---
title: The store keeps a damaged file and its id
status: done
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/sessions/sessions.ts#L830-L870](../../../../packages/sdk/src/sessions/sessions.ts#L830-L870) - `setAside` and `load`, which this task replaces"
---

## Objective

A file that cannot be read stays in place, its id and reason are in `damaged()`, no write touches it, and `forget` removes it.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts:676` - add `damaged?(): ReadonlyMap<string, string>` to `SessionStore`.
- `UPDATE: packages/sdk/src/sessions/sessions.ts:824-870` - remove `setAside`, record damaged ids in `load`, skip them in `save`, remove the file in `forget`.
- `UPDATE: packages/sdk/test/sessions.test.ts:1500-1540` - replace the two move-aside cases.

## Steps

1. Add the optional `damaged` method to `SessionStore`, with a comment on what the map holds.
2. Declare a `damaged` map of id to reason in the file store.
3. Replace `setAside` with a branch of `load` that records the id from the file name and the reason, and leaves the file.
4. Accept a row only if it is an object, of version 1, with an `id` equal to the file name's id.
5. Log one line for an unreadable folder in `load`.
6. Skip a damaged id in `save`, and log that its write was not made.
7. Make `forget` of a damaged id drop the entry and remove its file.
8. Leave a damaged id out of `sessions()` and out of `prune`.
9. Expose `damaged` on the store that `fileSessions` returns.
10. Write the cases: not JSON, `null`, a wrong `id`, a write skipped, a prune that leaves it, a forget that removes it.

## Validation

- `pnpm --filter @ahpd/sdk exec vitest run test/sessions.test.ts` passes.

## Resume

