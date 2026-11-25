---
title: An operation checks the nonce
status: done
depends: []
layer: "sdk sessions"
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L712-L740](../../../../packages/sdk/src/sessions/changes.ts#L712-L740) - `rowsOf`"
  - "[code://packages/sdk/src/sessions/changes.ts#L1822-L1840](../../../../packages/sdk/src/sessions/changes.ts#L1822-L1840) - `invoke`"
---

## Objective

Each changeset row has a `nonce`, a hash of its two sides. An operation whose target names another nonce fails with `Conflict`, and a target with no nonce runs as before.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts` - the nonce on each row, and the check in `invoke`.
- `UPDATE: packages/sdk/test/chat-changesets.test.ts` - the nonce cases.

## Steps

1. Hash the before and after content of a row with SHA-256, and put the first 16 hex digits as `nonce`.
2. In `invoke`, when the target has a `nonce`, read the target's row again.
3. Fail with `-32011` and `The changes to <file> changed since they were shown.` when the nonces differ.
4. Add cases: an operation with the current nonce runs, and one with an old nonce fails.
5. Add a case: an operation with no nonce runs.

## Validation

- `chat-changesets.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The check is in `invokeChangesetOperation`, before the operation runs, so a contributed operation is checked too. The cases are in `changes-editing.test.ts`.
