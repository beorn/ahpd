---
title: Each chat advertises its changesets
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/snapshots.ts#L232-L251](../../../../packages/sdk/src/host/snapshots.ts#L232-L251) - a chat's snapshot"
  - "[code://packages/sdk/src/host/facts.ts#L622-L631](../../../../packages/sdk/src/host/facts.ts#L622-L631) - the session's list said again"
---

## Objective

A chat's state carries its own changesets, and a change to the session's list is said to each chat.

## Files

- `UPDATE: packages/sdk/src/host/changesets.ts` - `chatCatalogueOf`, the chat's list built from the session's scopes.
- `UPDATE: packages/sdk/src/host/snapshots.ts` - a chat's snapshot carries the list.
- `UPDATE: packages/sdk/src/host/facts.ts` - `chat/changesetsChanged` to each chat when the list moves.
- `UPDATE: packages/sdk/test/chat-changesets.test.ts` - the list and its update.

## Steps

1. Build a chat's list from the session's scopes: Branch, Uncommitted, This Turn and Compare Turns, under the chat URI.
2. Leave the Session entry out of the chat's list.
3. Put the list in each chat's snapshot, unless the session's machine serves its changesets.
4. Say `chat/changesetsChanged` to each chat of the session when its list differs from the chat's state.

## Validation

- `packages/sdk/test/chat-changesets.test.ts` - the list in a chat's snapshot, and the update after a first turn.
- The sdk vitest suite passes.

## Resume
