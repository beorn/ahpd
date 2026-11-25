---
title: Worktree removals are a queue
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://a0cd1337f - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, section *Later*, remote worktree cleanup
  - "[code://packages/sdk/src/host/lifecycle.ts#L1784-L1854](../../../../packages/sdk/src/host/lifecycle.ts#L1784-L1854) - `requestSessionWorktreeRemoval`, which removes inline and only logs what it kept"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1856-L1878](../../../../packages/sdk/src/host/lifecycle.ts#L1856-L1878) - `restoreSessionWorktree`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1596-L1601](../../../../packages/sdk/src/host/lifecycle.ts#L1596-L1601) - a tree's branch, `<prefix>agents/<name>`, under `<repo>.worktrees`"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L889](../../../../packages/sdk/src/host/vscodemethods.ts#L889) - where `vscode/*` methods are served"
  - "[code://packages/sdk/src/host/gate.ts#L117](../../../../packages/sdk/src/host/gate.ts#L117) - the grant each method needs"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agentHostWorktreeCleanup.ts`, `common/meta/vscode/agentHostWorktreeCleanupMeta.ts`, `node/agentHostWorktreeCleanupService.ts`, `common/worktreePaths.ts`
---

## Goal

A worktree an archived session gives back is removed through a queue that survives a restart and tries again, as VS Code's host removes one. A client can ask how a session's cleanup went, and retry or force it. It can list and remove the worktrees this host made that no session holds.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "sessionWorktreeCleanup|listManagedWorktrees" packages/` - nothing: ahpd serves none of the four methods.
- `rg "requestSessionWorktreeRemoval" packages/sdk/src` - the archive paths in `sleep.ts` and `sessionlifecycle.ts` call it.

### Runtime path

```
archive -> requestSessionWorktreeRemoval -> a removal record -> a pass -> port.remove -> the record goes, or stays with its status
```

### Gaps

- A tree kept for a reason, or a removal that failed, is logged and never tried again.
- No method answers a cleanup's status, and no method lists or removes an orphaned worktree.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Port VS Code's removal queue | Softov, 2026-11-21, chose "Port VS Code's queue" | 01, 02, 03 |
| A record per tree: kind, owner, repository, path, branch, mode, requested time, attempts, next attempt and last status | (defaulted: VS Code `IPendingWorktreeRemoval`) | 01 |
| The records are kept by a `WorktreeRemovals` port: a memory one in the sdk, a file one in the daemon's state folder | (defaulted: the shape of the host's other ports) | 01 |
| A pass runs 3 s after a request and every 5 minutes while records remain; a failure waits 30 s, doubled per attempt up to an hour | (defaulted: VS Code's defaults) | 01 |
| A tree kept for a reason, such as unsynced work, is `skipped` and tried again later | (defaulted: VS Code L781-L786) | 01 |
| An unarchive drops the session's records | (defaulted: VS Code L728-L733) | 01 |
| The status order is running, pending, failed, inUse, skipped, unknown | (defaulted: VS Code L373-L378) | 02 |
| `force` needs `retry`; `retry` needs an archived session | (defaulted: VS Code L343-L349) | 02 |
| A managed worktree is a folder under `<repo>.worktrees` on a branch ending `agents/<folder>` | (defaulted: VS Code `isAgentWorktreeBranch`, `_isManagedWorktree`) | 03 |
| The initialize `_meta` advertises `vscode.worktreeCleanup`, `vscode.forceWorktreeCleanup`, `vscode.prepareSessionWorktreeCleanup` and `vscode.managedWorktrees` | (defaulted: VS Code L1258-L1261) | 02, 03 |
| Co-owned worktrees and scratch folders stay out: ahpd shares no worktree between sessions and keeps scratch folders apart | (defaulted: ahpd has neither queue) | - |

## Proposed architecture

- **Data flow** - `requestSessionWorktreeRemoval` writes a record per tree; the pass reads due records and runs today's checks before `port.remove`.
- **State flow** - a record goes on success, and stays with its status and next attempt otherwise.
- **Layer responsibilities** - sdk: the queue, the pass and the methods · server: the file port.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A removal is a record a pass works through](task-01-a-removal-is-a-record.md) | done | - |
| [02 - A client asks a session's cleanup](task-02-a-client-asks-a-sessions-cleanup.md) | done | 01 |
| [03 - A client lists and removes managed worktrees](task-03-managed-worktrees.md) | done | 01 |

## Risks and tradeoffs

- A tree that keeps failing is tried again forever, an hour apart. The log says so from the fifth attempt, as VS Code warns.
- A force removes a tree whose work is not synced. Only a client that confirmed it sends `force`, as VS Code's window asks.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: an archive writes a record, a pass removes the tree, and the record goes.
- [x] A test: a skipped or failed removal stays, with its status, and is tried again after its wait.
- [x] A test: an unarchive drops the records.
- [x] A test: `vscode/sessionWorktreeCleanup` answers the status, retries, and forces.
- [x] A test: `vscode/listManagedWorktrees` lists an orphan, and `vscode/cleanupManagedWorktree` removes it.
- [x] The gates pass: typecheck, boundary, and the sdk, server and computer suites.
