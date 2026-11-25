---
title: Turn changesets under the chat
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://80ee689aa - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, section *Later*, turn changesets under the chat
  - "[code://packages/sdk/src/host/changesets.ts#L115-L154](../../../../packages/sdk/src/host/changesets.ts#L115-L154) - `catalogueOf`, `changesetAt` and `changesetOf`, which read the owner as a session"
  - "[code://packages/sdk/src/host/changesets.ts#L737-L743](../../../../packages/sdk/src/host/changesets.ts#L737-L743) - `relayedChannel`"
  - "[code://packages/sdk/src/host/facts.ts#L622-L631](../../../../packages/sdk/src/host/facts.ts#L622-L631) - where `session/changesetsChanged` is said"
  - "[code://packages/sdk/src/host/snapshots.ts#L232-L251](../../../../packages/sdk/src/host/snapshots.ts#L232-L251) - a chat's snapshot"
  - "[code://packages/sdk/src/sessions/changes.ts#L1429-L1494](../../../../packages/sdk/src/sessions/changes.ts#L1429-L1494) - the scopes a session offers"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/changesetUri.ts`: `buildDefaultChangesetCatalog`, `resolveChatChangesetCatalogue`, `parseChangesetUri`
---

## Goal

Each chat advertises its own changesets, as VS Code main's host does. This Turn is `<chatUri>/changeset/turn/{turnId}`, and the host serves it and every other changeset named under a chat URI. The session's own list stays as it is.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "chat/changesetsChanged" packages/sdk/src` - only the nested relay in `sessions/nested.ts`: the host says no chat's changesets of its own.
- `rg "changesets" ahpw/src ahpc/src` - both read `SessionState.changesets` only.

### Runtime path

```
chat snapshot -> chat.changesets -> subscribe <chatUri>/changeset/<scope> -> changesetAt maps the chat to its session -> the session's scope state
```

### Gaps

- A chat's state has no `changesets`.
- `changesetAt`, `changesetOf` and `relayedChannel` read the URI before `/changeset/` as a session, so a chat-owned changeset is not found.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Add the chat list and keep the session list as it is | Softov, 2026-11-21, chose "Add it, keep session list" | 01, 02 |
| A chat's list is Branch, Uncommitted, This Turn and Compare Turns, each under the chat URI, in VS Code main's order, where the session offers that scope | (defaulted: VS Code `buildDefaultChangesetCatalog`) | 02 |
| A chat's list has no Session entry: VS Code's window puts the session's own before This Turn | (defaulted: VS Code `resolveChatChangesetCatalogue`) | 02 |
| A changeset under a chat is the same changeset as the one under its session | (defaulted: ahpd keeps one checkpoint store per session) | 01 |
| A chat of a session whose machine serves its changesets says none of its own | (defaulted: `relaysChangesets`) | 02 |

## Proposed architecture

- **Data flow** - a chat URI before `/changeset/` resolves to the session that holds the chat; the rest is unchanged.
- **State flow** - when a session's list moves, each of its chats gets `chat/changesetsChanged` with its own list.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - [`code://packages/sdk/src/host/changesets.ts`](../../../../packages/sdk/src/host/changesets.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A changeset under a chat is served](task-01-a-changeset-under-a-chat-is-served.md) | done | - |
| [02 - Each chat advertises its changesets](task-02-each-chat-advertises-its-changesets.md) | done | 01 |

## Risks and tradeoffs

- Two URIs name one changeset, so a client that subscribes to both gets each update twice. Each subscription is its own channel, so neither breaks.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: `<chatUri>/changeset/turn/<turnId>` answers the turn's files, and a change to them is said on that channel.
- [x] A test: a chat's snapshot carries its list, and `chat/changesetsChanged` follows the session's list.
- [x] The gates pass: typecheck, boundary, and the sdk and computer suites.
