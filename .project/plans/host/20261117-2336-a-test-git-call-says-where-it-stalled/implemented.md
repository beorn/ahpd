---
title: A test's own git call says where it stalled - implemented
date: 2026-11-18
refs:
  - git://a3b0b01a2 - the merge of #371
---

A git call that a test makes itself fails at its own line when it stalls, and names the call.
Today such a call has no timeout and no timing, so a stall shows only as vitest's timeout of the whole case.

## What was built

- [`code://tools/git.ts`](../../../../tools/git.ts) - `gitSync(args, options)`, a test's own synchronous git call.
- [`code://packages/sdk/src/repo/hardened.ts`](../../../../packages/sdk/src/repo/hardened.ts) - export `timed`, and say in its comment that test calls use it too.
- [`code://packages/sdk/test/test-git.test.ts`](../../../../packages/sdk/test/test-git.test.ts) - the cases of `gitSync`.
- [`code://packages/sdk/test/worktrees.test.ts`](../../../../packages/sdk/test/worktrees.test.ts) - its git calls go through `gitSync`; the branches case is here.
- [`code://packages/sdk/test/changes-refresh.test.ts`](../../../../packages/sdk/test/changes-refresh.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/agentmerge-watch.test.ts`](../../../../packages/sdk/test/agentmerge-watch.test.ts) - its git call goes through `gitSync`.
- [`code://packages/sdk/test/changes-branch.test.ts`](../../../../packages/sdk/test/changes-branch.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/changes-review.test.ts`](../../../../packages/sdk/test/changes-review.test.ts) - its git call goes through `gitSync`.
- [`code://packages/sdk/test/changes-uris.test.ts`](../../../../packages/sdk/test/changes-uris.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/changewords.test.ts`](../../../../packages/sdk/test/changewords.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/checkpoints.test.ts`](../../../../packages/sdk/test/checkpoints.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/commit.test.ts`](../../../../packages/sdk/test/commit.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/git-locks.test.ts`](../../../../packages/sdk/test/git-locks.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/git.test.ts`](../../../../packages/sdk/test/git.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/host-github.test.ts`](../../../../packages/sdk/test/host-github.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/host-merged.test.ts`](../../../../packages/sdk/test/host-merged.test.ts) - its git calls go through `gitSync`.
- [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) - its git call goes through `gitSync`.
- [`code://packages/sdk/test/pullrequest.test.ts`](../../../../packages/sdk/test/pullrequest.test.ts) - its git calls go through `gitSync`.
- [`code://packages/computer/test/computer-cleanup.test.ts`](../../../../packages/computer/test/computer-cleanup.test.ts) - its git call goes through `gitSync`.
- [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../../packages/computer/test/computer-devcontainer.test.ts) - its `spawnSync` git call goes through `gitSync`.
- [`code://packages/computer/test/computer-disposable.test.ts`](../../../../packages/computer/test/computer-disposable.test.ts) - its git calls go through `gitSync`; the subfolder case is here.
- [`code://packages/computer/test/computer-far-git.test.ts`](../../../../packages/computer/test/computer-far-git.test.ts) - its git calls go through `gitSync`.
- [`code://packages/computer/test/computer-git-fetch.test.ts`](../../../../packages/computer/test/computer-git-fetch.test.ts) - its git calls go through `gitSync`.
- [`code://packages/computer/test/computer-git-guard.test.ts`](../../../../packages/computer/test/computer-git-guard.test.ts) - its git calls go through `gitSync`.
- [`code://packages/computer/test/computer-git-own.test.ts`](../../../../packages/computer/test/computer-git-own.test.ts) - its git calls go through `gitSync`.
- [`code://packages/computer/test/computer-plugin.test.ts`](../../../../packages/computer/test/computer-plugin.test.ts) - its `spawnSync` git call goes through `gitSync`.
- [`code://DEVELOPER.md`](../../../../DEVELOPER.md) - a test's own git call goes through `tools/git.ts`, and the variable names its stalls too.

## Verified

- `rg "execFileSync\('git'|spawnSync\('git'" packages/*/test` finds nothing.
- The sdk and computer suites pass, and `check-windows` is green.
- A run with `AHPD_GIT_SLOW_MS=1` prints a `slow git:` line for a test's own git call.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #371.

## Departures from the plan

- The `{ stdio: 'pipe' }` and `{ encoding: 'utf8' }` options went with the calls, since `gitSync` sets both. The same options on `docker` calls stay.

## Left for later

- The cases this plan is for can still fail - [git-cases-time-out-on-windows.md](../../../problems/git-cases-time-out-on-windows.md) waits for the next stall to name its call.
