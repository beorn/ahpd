---
title: Turn changesets under the chat - implemented
plan: plans/host/20261121-1553-turn-changesets-under-the-chat/plan.md
---

## What exists now

- `sessionOfOwner` in `packages/sdk/src/host/changesets.ts` reads the URI before `/changeset/` as a session, or as a chat that resolves to the session that holds it. `changesetAt`, `changesetOf` and `relayedChannel` use it, so a changeset under a chat is served and gets its updates.
- `chatChangesetsOf` builds a chat's list from the session's scopes: Branch, Uncommitted, This Turn and Compare Turns, under the chat URI, with no Session entry.
- A chat's snapshot carries the list, unless the session's machine serves its changesets.
- `chatChangesetsMoved` says `chat/changesetsChanged` to each chat whose list differs from its state. It runs in the three places that say `session/changesetsChanged`.
- The session's own list is unchanged.

## Verified

- `packages/sdk/test/chat-changesets.test.ts` - the chat's list, and the session's list unchanged.
- The same file - a turn's files under the chat and under the session, and the chat's list said again after a turn.
- The users gate reads a chat-owned changeset as a session channel, with the same grant as the session form.

## Departures from the plan

- The session's list is said in three places, not one: the folder watch, a refresh of the facts, and a change to the session's row. Each now says the chats' lists too, through one function.
