---
title: A session's changes have one key, and a new folder is read at once
domain: host
status: built
priority: medium
created: 2026-11-23
revalidated: 2026-11-23
refs:
  - git://e68555ee0 - the last commit that holds `problems/a-sessions-changes-are-kept-under-two-keys.md`, which this plan fixes
  - git://e68555ee0 - the last commit that holds `problems/a-worktree-made-after-start-offers-no-changeset.md`, which this plan fixes
  - git://e68555ee0 - main when the plan was written
  - "[code://packages/sdk/src/host/spawn.ts#L984-L989](../../../../packages/sdk/src/host/spawn.ts#L984-L989) - `checkpointOf` keys the checkpoints by `idOf(uri)`"
  - "[code://packages/sdk/src/host/spawn.ts#L1974-L1978](../../../../packages/sdk/src/host/spawn.ts#L1974-L1978) - `onFileEdit` hands `observe` the session URI"
  - "[code://packages/sdk/src/host/changesets.ts#L120](../../../../packages/sdk/src/host/changesets.ts#L120) - `scopes` is asked with the session URI"
  - "[code://packages/sdk/src/host/changesets.ts#L149-L157](../../../../packages/sdk/src/host/changesets.ts#L149-L157) - `changesetAt` answers the session URI as `owner`"
  - "[code://packages/sdk/src/host/changesets.ts#L662](../../../../packages/sdk/src/host/changesets.ts#L662) - `state` asked with `at.owner`, a URI"
  - "[code://packages/sdk/src/host/snapshots.ts#L514](../../../../packages/sdk/src/host/snapshots.ts#L514) - `state` asked with `at.owner`"
  - "[code://packages/sdk/src/host/actions.ts#L680](../../../../packages/sdk/src/host/actions.ts#L680) - `state` asked with `at.owner`"
  - "[code://packages/sdk/src/sessions/changes.ts#L814](../../../../packages/sdk/src/sessions/changes.ts#L814) - `sessionFiles(dir, session)` reads the checkpoints and the tracker under one key"
  - "[code://packages/sdk/src/types/changes.ts#L400-L527](../../../../packages/sdk/src/types/changes.ts#L400-L527) - the changes port; its `session` argument is not documented as an id or a URI"
  - "[code://packages/sdk/src/sessions/catalog.ts#L123-L126](../../../../packages/sdk/src/sessions/catalog.ts#L123-L126) - `idOf`, which answers an id unchanged"
  - "[code://packages/sdk/src/host/spawn.ts#L2151-L2172](../../../../packages/sdk/src/host/spawn.ts#L2151-L2172) - the backend start, \"the one road to a running backend\", which writes the baseline checkpoint"
  - "[code://packages/sdk/src/host/spawn.ts#L1912-L1925](../../../../packages/sdk/src/host/spawn.ts#L1912-L1925) - a turn's end already calls `refreshFacts(dir)`"
  - "[code://packages/sdk/src/host/facts.ts#L870-L921](../../../../packages/sdk/src/host/facts.ts#L870-L921) - `readFacts` and `refreshFacts`, which run `changes.refresh(dir)` and send the changed catalogue"
  - "[code://packages/sdk/src/sessions/changes.ts#L1429-L1440](../../../../packages/sdk/src/sessions/changes.ts#L1429-L1440) - `scopes` offers Uncommitted Changes only for a folder `refresh` has read"
---

## Goal

A session's "This Session" changeset and its row show the same files, a file that a shell command wrote among them. A folder that is not a git repository has counts. A session in a folder the daemon has not read offers its Uncommitted Changes from its first moment. A worktree made after the start is such a folder.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "checkpointOf|observe\?\.\(" packages/sdk/src/host/spawn.ts` - checkpoints get `idOf(uri)`, the tracker gets the URI.
- `rg "changes\?\.state\(|changes\?\.scopes\(" packages/sdk/src/host` - three `state` callers and one `scopes` caller pass the URI.
- `rg "refreshFacts\(|readFacts\(" packages/sdk/src/host` - the folder is read at a turn's end, on a changeset subscribe, and on a resource write; not when a backend starts.

### Runtime path

```
backend start -> baseline checkpoint (id) -> turn: onFileEdit -> observe (URI) -> turn end: checkpoint (id), refreshFacts(dir)
client: changeset channel -> changesetAt (owner = URI) -> changes.state(dir, URI, scope) -> sessionFiles(dir, URI): checkpoints miss, tracker answers
```

### Gaps

- The `session` argument of the changes port has two spellings.
- A folder is first read at a turn's end or a changeset subscribe. A session in a new folder offers no Uncommitted Changes during its first turn.
- Finding: the turn-end read that Softov chose already exists (`spawn.ts:1924`). The problem's session ran one long turn, so it showed nothing until that turn ended.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every call of the changes port names the session by its id, `idOf(uri)`, as the checkpoints do | Softov, 2026-11-23: "Key everything by the id" | 01 |
| The port's type says `session` is the session id | (defaulted: a port another plugin can replace needs the contract written) | 01 |
| The host reads a session's folder when its backend starts, and at each turn's end as today | Softov, 2026-11-23: "Both: on a new folder and each turn's end" | 02 |
| The read at the backend start covers a worktree the host made and a session opened in a new folder, because the worktree is the session's working directory | [code://packages/sdk/src/host/spawn.ts#L2151-L2172](../../../../packages/sdk/src/host/spawn.ts#L2151-L2172) | 02 |

## Proposed architecture

- **Data flow** - the host turns the URI into the id at each call of the port: `observe`, `state`, `scopes`, and the summary. The changes store keys everything by what it is handed.
- **Event flow** - the backend start calls `refreshFacts(dir)` after the baseline checkpoint is written, as a turn's end does after its checkpoint.
- **State flow** - unchanged: the tracker's `seen` and the checkpoint refs now share one key.
- **Layer responsibilities** - sdk host: passes the id and reads the folder. sdk sessions: unchanged apart from the documented key.
- **Source-of-truth files** - [`code://packages/sdk/src/types/changes.ts`](../../../../packages/sdk/src/types/changes.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the changes port takes the session id](task-01-the-changes-port-takes-the-id.md) | done | - |
| [02 - a backend start reads its folder](task-02-a-backend-start-reads-its-folder.md) | done | 01 |

## Risks and tradeoffs

- The tracker's entries are in memory, so nothing stored moves: a session live across the change loses only what the tracker held before the restart.
- One more folder read per backend start. A start is rare next to a turn's end, which already reads.

## Resume state

- **Done so far:** tasks 01 and 02, on 2026-11-23. [implemented.md](implemented.md) holds the checks.
- **Next action:** none. `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** `changesetAt`'s `owner` is used elsewhere as a URI, for the status and the operation context. Convert at the port call, not in `changesetAt`.

## Final verification checklist

- [ ] A file a shell command wrote is in the session's "This Session" changeset.
- [ ] A session in a folder with no git has counts on its row.
- [ ] A session started in a new worktree offers Uncommitted Changes before its first turn ends.
- [ ] The sdk suite and the computer suite pass.
