---
title: Agent Merge merges a pull request - implemented
date: 2026-11-10
refs:
  - git://032300137
  - "[code://packages/sdk/src/host/agentmerge.ts](../../../../packages/sdk/src/host/agentmerge.ts) - the merge gate"
---

A folder with Agent Merge on merges its pull request once it is ready, when the person's merge choice allows it. `never` stays the default. PR #280 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/host/agentmerge.ts`](../../../../packages/sdk/src/host/agentmerge.ts) - `always` and `ifUnchanged` merge a ready pull request, VS Code's gate. The pull request is read again before the merge, and the merge names its head commit.
- [`code://packages/sdk/src/repo/github.ts`](../../../../packages/sdk/src/repo/github.ts) - the merge with `mergeMethod`, where `auto` prefers squash, then merge, then rebase.

## Verified

- `agentmerge-watch.test.ts` and `github.test.ts`. CI passed on #280, which merged after #279.

## Departures from the plan

- A repository that requires a merge queue is not merged, and the watch stays on.

## Left for later

- None.
