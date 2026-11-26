---
title: A long operation answers a process
status: todo
depends: 
  - task-02-the-host-serves-processes.md
layer: "sdk"
---

## Objective

An operation with `long: true` answers its call with a process at once, and its work runs in it.

## Files

- `UPDATE: packages/sdk/src/types/kinds.ts` - `long` on `KindOperation`.
- `UPDATE: packages/sdk/src/lists/channel.ts` - a long call starts a process and answers it.
- `UPDATE: packages/sdk/src/kinds/operations.ts` - `long` in the operation's entry.
- `CREATE: packages/sdk/test/list-long-operations.test.ts` - the cases.

## Steps

1. Add `long` to `KindOperation`, and send it in the operation's entry.
2. Answer a long call with `{ process }` at once.
3. Run the kind's `invoke` inside the process, with its report and signal.

## Validation

- A long call answers a process URI before the work ends.
- Its work reaches `completed`, and a stop ends it.

## Resume
