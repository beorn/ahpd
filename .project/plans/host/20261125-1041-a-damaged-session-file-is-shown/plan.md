---
title: A damaged session file is shown, not dropped
domain: host
status: built
priority: medium
created: 2026-11-25
revalidated: 2026-11-25
refs:
  - git://2b164c19fd8a5e9856ce4846077b26547b23a652 - the commit of this repository the facts were checked at (the brief `a-damaged-session-file-is-shown-not-dropped.md` was never committed, and is not in this branch)
  - https://github.com/ahpio/ahpd/issues/471 - the report, by beorn
  - "[code://packages/sdk/src/sessions/sessions.ts#L830-L870](../../../../packages/sdk/src/sessions/sessions.ts#L830-L870) - `setAside` and `load`: a file that is not read is moved aside and its id is not kept"
  - "[code://packages/sdk/src/sessions/sessions.ts#L776-L798](../../../../packages/sdk/src/sessions/sessions.ts#L776-L798) - `save` writes each dirty id, or removes its file"
  - "[code://packages/sdk/src/sessions/sessions.ts#L1095-L1112](../../../../packages/sdk/src/sessions/sessions.ts#L1095-L1112) - `forget` and `prune`, which remove the file"
  - "[code://packages/sdk/src/host/catalogue.ts#L1726-L1732](../../../../packages/sdk/src/host/catalogue.ts#L1726-L1732) - `computeSessions`, the one list every listing reads"
  - "[code://packages/sdk/src/host/lifecycle.ts#L775-L823](../../../../packages/sdk/src/host/lifecycle.ts#L775-L823) - `mayDispose` and the start of `removeSession`"
  - "[code://packages/sdk/src/sessions/nested.ts#L1501](../../../../packages/sdk/src/sessions/nested.ts#L1501) - a row that says `lifecycle: 'failed'` with a `creationError`"
---

## Goal

A session whose ahpd file cannot be read is shown to the person as a failed session, and is never taken for one that does not exist or for an ordinary one.
The file stays where it is and nothing writes over it.
The person can delete the session, and that removes the file.
This fixes both problems of issue 471: a damaged row served as absent, and an archived session that comes back as active.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "unreadable" packages/sdk` - `setAside` and two tests in `sessions.test.ts` hold the move-aside behaviour.
- `rg -n "kept.sessions()" packages/sdk/src` - the host and the listing read each id, so a damaged id must not be in `sessions()`.

### Runtime path

```
daemon start -> load -> damaged file -> id and reason recorded, file left
listSessions -> computeSessions -> one failed row per damaged id
disposeSession -> removeSession -> kept.forget -> file removed
```

### Gaps

- The store does not say which ids are damaged.
- `removeSession` reads an owner and an agent that a damaged id has not.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The file stays in place at `sessions/<id>.json`, and is not moved aside | Softov, 2026-11-25, chose "Keep in place" | 01 |
| A person can only delete a damaged session | Softov, 2026-11-25, chose "A: delete only" | 02 |
| The store keeps each damaged id with its reason, apart from `sessions()` | [code://packages/sdk/src/host/chatrecord.ts#L137-L140](../../../../packages/sdk/src/host/chatrecord.ts#L137-L140) | 01 |
| `load` accepts a row that is an object, of version 1, whose `id` is the one in its file name; `null` is damaged | the brief, from beorn's branch | 01 |
| A write for a damaged id is not made, and is logged | the brief | 01 |
| A prune leaves a damaged file; a `forget` removes it | the brief | 01 |
| The host lists each damaged id as a failed row with `creationError`, whatever `showExternalSessions` says, and never as external | the brief | 02 |
| Delete removes the file with no agent copy removed, and needs `session:*` or a root connection | the brief, from `mayDispose` | 02 |
| The `provider` of the failed row is `unknown` | (defaulted: the protocol requires a provider, and none can be read from the file) | 02 |
| An unreadable folder still starts an empty store, and now logs a line | (defaulted: the brief leaves the log open, and a line costs nothing) | 01 |
| The archived bit is not kept in a second place | (defaulted: out of scope, the failed row does not say it) | - |

## Proposed architecture

- **State flow** - `load` records damaged ids in a map, `save` skips them, `forget` removes the file.
- **Data flow** - `computeSessions` adds a failed row for each id of that map.
- **Layer responsibilities** - sdk sessions: the store · sdk host: the listing and the delete.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the store keeps a damaged file](task-01-the-store-keeps-a-damaged-file.md) | done | - |
| [02 - the host shows and deletes it](task-02-the-host-shows-and-deletes-it.md) | done | 01 |

## Risks and tradeoffs

- A damaged file stays until a person deletes it, so a folder can hold it for ever - the failed row says it is there.
- The failed row cannot say whether the session was archived.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-25.
- **Next action:** none. The plan is built.
- **Open questions:** none.
- **Watch out for:** `sessions()` must not list a damaged id, or the host throws as it is built.

## Final verification checklist

- [x] `pnpm --filter @ahpd/sdk test` passes, run alone.
- [x] `pnpm typecheck` and `pnpm boundary` pass.
