---
title: Every test runs its own git through gitSync
status: done
depends: [task-01-a-test-git-call-has-a-timeout.md]
layer: "tests"
refs:
  - "[code://packages/sdk/test/worktrees.test.ts#L54-L81](../../../../packages/sdk/test/worktrees.test.ts#L54-L81) - `repository`, the setup of the branches case"
  - "[code://packages/computer/test/computer-plugin.test.ts#L660](../../../../packages/computer/test/computer-plugin.test.ts#L660) - a `spawnSync` setup call that reads no status"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1961](../../../../packages/computer/test/computer-devcontainer.test.ts#L1961) - the other `spawnSync` setup call"
  - "[code://DEVELOPER.md#L85](../../../../DEVELOPER.md#L85) - what `AHPD_GIT_SLOW_MS` does"
---

## Objective

No test file calls `execFileSync('git'` or `spawnSync('git'`, and a case fails when one does.
The problem files say that a stall in a test's own git call now names the call.

## Files

- `UPDATE: packages/sdk/test/worktrees.test.ts` - its git calls go through `gitSync`; the branches case is here.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/agentmerge-watch.test.ts` - its git call goes through `gitSync`.
- `UPDATE: packages/sdk/test/changes-branch.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/changes-review.test.ts` - its git call goes through `gitSync`.
- `UPDATE: packages/sdk/test/changes-uris.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/changewords.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/checkpoints.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/commit.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/git-locks.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/git.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/host-github.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/host-merged.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - its git call goes through `gitSync`.
- `UPDATE: packages/sdk/test/pullrequest.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/computer/test/computer-cleanup.test.ts` - its git call goes through `gitSync`.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - its `spawnSync` git call goes through `gitSync`.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - its git calls go through `gitSync`; the subfolder case is here.
- `UPDATE: packages/computer/test/computer-far-git.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/computer/test/computer-git-guard.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/computer/test/computer-git-own.test.ts` - its git calls go through `gitSync`.
- `UPDATE: packages/computer/test/computer-plugin.test.ts` - its `spawnSync` git call goes through `gitSync`.
- `UPDATE: packages/sdk/test/test-git.test.ts` - the case that reads every test file.
- `UPDATE: DEVELOPER.md:85` - a test's own git call goes through `tools/git.ts`, and the variable names its stalls too.
- `UPDATE: .project/problems/git-cases-time-out-on-windows.md` - the *Fix* section says that the next stall names the test's own call too.
- `UPDATE: .project/problems/a-disposable-machine-case-fails-at-random.md` - the *Fix* section says the same of the subfolder case.

## Steps

1. Replace each `execFileSync('git', <args>, <options>)` in the 23 files with `gitSync(<args>, <options>)`.
2. Remove a `.toString()` that `gitSync`'s string makes needless, and keep each `.trim()`.
3. Replace each `spawnSync('git', ...)` setup call in the two `computer` files with `gitSync`.
4. Remove each `execFileSync` and `spawnSync` import that no call needs after steps 1 and 3.
5. Add a case to `test-git.test.ts` that lists each `.ts` file under `packages/*/test` with a direct git call.
6. Make that case match `execFileSync('git'` and `spawnSync('git'`, and expect an empty list.
7. Add one sentence to `DEVELOPER.md` after line 85 about `tools/git.ts`.
8. Add one line to the *Fix* section of each problem file about the test's own git calls.
9. Run `node .agents/skills/do-spec/scripts/lint-prose.mjs` on the two problem files.

## Validation

- `rg "execFileSync\('git'|spawnSync\('git'" packages/*/test` finds nothing.
- The case of step 5 passes, and it fails on a file with one direct call.
- `pnpm typecheck` passes.
- The sdk suite passes, then the computer suite, one at a time, as HANDOFF *Tests* says.
- `AHPD_GIT_SLOW_MS=1` on `packages/sdk/test/worktrees.test.ts` prints `slow git:` lines for the case's own `git branch` calls.

## Resume

Built on 2026-11-17. The check case builds its probe strings from parts, because the literal calls in its own file matched the pattern. With one direct call put back in `computer-plugin.test.ts`, the case failed and named that file.
The `{ stdio: 'pipe' }` and `{ encoding: 'utf8' }` options went with the calls, since `gitSync` sets both. The same options on `docker` calls stay.

