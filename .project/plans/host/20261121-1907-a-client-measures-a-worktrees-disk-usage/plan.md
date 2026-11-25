---
title: A client measures a worktree's disk usage
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://bc9e0a4e0 - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Worktree disk usage*"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` handlers, beside the worktree cleanup four"
  - "[code://packages/sdk/src/host/gate.ts#L62](../../../../packages/sdk/src/host/gate.ts#L62) - the grant each method needs"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/worktreeDiskUsage.ts`, the measure and its cache; `node/protocolServerHandler.ts#L4148-L4189`, the handler; `common/meta/vscode/agentHostWorktreeDiskUsageMeta.ts`, the capability
---

## Goal

A client asks how much disk a worktree uses, as VS Code's window asks before it offers to remove one, and can cancel the question. The answer is what removing the worktree would free.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "DiskUsage" packages/` - nothing: ahpd serves neither method.

### Runtime path

```
vscode/measureWorktreeDiskUsage {uri, requestId, session?} -> a scan, at most two at once -> {sizeBytes}
vscode/cancelWorktreeDiskUsage {requestId} -> that scan stops
```

### Gaps

- No method answers a folder's disk usage, and none cancels one.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan worktree disk usage | Softov, 2026-11-21, "plan worktree disk usage and session move" | 01, 02 |
| The size is allocated bytes of regular files on the root's device, symlinks not followed, a hard-linked file counted only when all its links are inside | (defaulted: VS Code `measureWorktreeDiskUsage`) | 01 |
| A `uri` that is not an absolute `file:` URI, and a `requestId` already in use on the connection, are refused | (defaulted: VS Code L4149-L4170) | 01 |
| At most two scans run at once; a scan stops on its cancel and when its connection closes | (defaulted: VS Code `Limiter(2)`, L4174) | 01 |
| A missing root answers no `sizeBytes` | (defaulted: VS Code) | 01 |
| The initialize `_meta` advertises `vscode.worktreeDiskUsage` | (defaulted: VS Code L1256) | 01 |
| Both methods need `file:list`, as a listing of the folder would | (defaulted: the gate's file reads) | 01 |
| With `session`, an answer is kept in memory until the session changes or runs a turn, and two asks of one worktree wait one behind the other | (defaulted: VS Code's cache, kept in memory since ahpd has no database) | 02 |

## Proposed architecture

- **Data flow** - the method validates, takes a slot of two, and walks the tree with `lstat` and `opendir`.
- **State flow** - the scans in flight by connection and request id; the cache by session and worktree.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/repo/diskusage.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A worktree's disk usage is measured and cancelled](task-01-measured-and-cancelled.md) | done | - |
| [02 - A session's measure is kept until it changes](task-02-a-sessions-measure-is-kept.md) | done | 01 |

## Risks and tradeoffs

- A scan of a large tree reads every entry. The slot limit keeps two at most, and a cancel stops one between entries.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-21; see [implemented.md](implemented.md).
- **Next action:** none. Merged as #428, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** Windows reports `blocks` too; a negative value fails the scan, as VS Code's does.

## Final verification checklist

- [x] A test: a tree with a file, a symlink and a hard link outside it answers the expected bytes.
- [x] A test: a cancel stops a scan, a used request id is refused, and a bad URI is refused.
- [x] A test: a session's second ask is answered from the cache, and a change of the session reads again.
- [x] The gates pass: typecheck, boundary, and the sdk suite.
