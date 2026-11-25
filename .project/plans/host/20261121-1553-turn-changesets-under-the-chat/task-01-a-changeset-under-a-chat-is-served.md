---
title: A changeset under a chat is served
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/changesets.ts#L136-L154](../../../../packages/sdk/src/host/changesets.ts#L136-L154) - `changesetAt` and `changesetOf`"
---

## Objective

A subscription to `<chatUri>/changeset/<scope>` answers the scope of the session that holds the chat, and gets its updates.

## Files

- `UPDATE: packages/sdk/src/host/changesets.ts` - an owner that is a chat resolves to its session.
- `CREATE: packages/sdk/test/chat-changesets.test.ts` - the cases of both tasks.

## Steps

1. Resolve the owner in `changesetAt` through `ctx.sessionHolding` when it is a chat URI.
2. Match a chat-owned channel in `changesetOf` against the session that holds the chat.
3. Resolve the session in `relayedChannel` the same way.
4. Check that the users gate reads a chat-owned changeset channel as its session's.

## Validation

- `packages/sdk/test/chat-changesets.test.ts` - a turn's files under the chat URI, and an update on that channel.
- The sdk vitest suite passes.

## Resume
