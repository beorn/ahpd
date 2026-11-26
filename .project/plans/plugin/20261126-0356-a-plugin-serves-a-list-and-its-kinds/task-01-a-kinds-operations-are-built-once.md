---
title: A kind's operations are built once
status: done
depends: []
layer: "sdk kinds"
refs:
  - "[code://packages/sdk/src/tunnels/channel.ts#L196-L213](../../../../packages/sdk/src/tunnels/channel.ts#L196-L213) - `offersOf`, moved into the shared function"
  - "[code://packages/sdk/src/tunnels/channel.ts#L319-L383](../../../../packages/sdk/src/tunnels/channel.ts#L319-L383) - `operationsOf`, moved into the shared function"
  - "[code://packages/sdk/src/kinds/operations.ts](../../../../packages/sdk/src/kinds/operations.ts) - where the shared function goes, beside `withOperations`"
---

## Objective

One function builds the operations of a kind and the ids one row offers, for any channel that holds kinds.
The tunnels channel uses it, and the list channel of task 04 uses it too.

## Files

- `UPDATE: packages/sdk/src/kinds/operations.ts` - add `kindOperations` and `kindOffers`, built from the tunnels channel's code.
- `UPDATE: packages/sdk/src/tunnels/channel.ts:196-383` - `offersOf` and `operationsOf` call the shared functions and add `enable` and `disable`.
- `UPDATE: packages/sdk/test/tunnels-channel.test.ts` - no change expected; it guards the move.

## Steps

1. Read `operationsOf` and `offersOf` in `tunnels/channel.ts`.
2. Write `kindOperations(kind, { subject, scope, status, update })` in `kinds/operations.ts`.
3. Make it answer `<kind>/create`, `<kind>/remove`, each `<kind>/<id>`, and `<kind>/update` when asked.
4. Give create and update the kind's schema as their input.
5. Take the grants from `subject`: `<subject>:put` for every operation but remove, and `<subject>:delete` for remove.
6. Take the record scope from `scope`, such as `tunnel` or `todo`.
7. Write `kindOffers(kind, row, update)` that answers the ids one row offers, by each operation's `offered`.
8. Make `operationsOf` in the tunnels channel call `kindOperations` and add its `enable` and `disable`.
9. Make `offersOf` in the tunnels channel call `kindOffers` and add `enable` or `disable`.
10. Keep every label, description and confirmation the tunnels channel sends today.

## Validation

- `npx vitest run packages/sdk/test/tunnels-channel.test.ts` passes with no test changed.
- `packages/sdk/test/kind-operations.test.ts` builds a todo kind's operations with `subject` and `scope` set to `todo`.
- It compares them with the todo brief's `ahpd.channels` example.

## Resume

Built on 2026-11-26. The shared function takes the words of update and remove as a parameter.
The tunnels say "Deletes this tunnel.", and a list says what the todo brief's example says.
