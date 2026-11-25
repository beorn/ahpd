---
title: A machine's record is read once per operation
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L2555-L2599](../../../../packages/computer/src/runtime.ts#L2555-L2599) - `containerOf` and `containerOrFail`"
  - "[code://packages/computer/test/computer-disposable.test.ts](../../../../packages/computer/test/computer-disposable.test.ts) - the git-volume case, whose calls the test counts"
---

## Objective

An operation of the runtime reads a machine's `docker inspect` record once, and a test holds the count.

## Files

- `UPDATE: packages/computer/src/runtime.ts:2555-2599` - `containerOf` answers the name and the record; `containerOrFail` likewise.
- `UPDATE: packages/computer/src/runtime.ts:2609-2623` - `look` uses the record `containerOf` read.
- `UPDATE: packages/computer/src/runtime.ts:2750-2800` - `bringBackOfMachine` and `followOfMachine` take a record their caller holds.
- `UPDATE: packages/computer/src/runtime.ts:3567-3600` - `remove` reads the record once and hands it on.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - a case that counts a disposable machine's docker calls.

## Steps

1. Make `containerOf` answer `{ at, record }`, with no record for a container found through `ps`.
2. Read the record with `recordOf` only where `containerOf` gave none.
3. Change each of the 13 callers to use the record that `containerOf` answers.
4. Pass the record from `remove` to `bringBackOfMachine`, and keep the public `bringBack` and `follow` reading it once.
5. Add a case that counts the `inspect` calls and all docker calls of one disposable machine's life.

## Validation

- `packages/computer/test/computer-disposable.test.ts` - a disposable machine's life makes 4 `inspect` calls and 21 docker calls.
- The computer vitest suite passes.

## Resume
