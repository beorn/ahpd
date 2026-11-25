---
title: A test's own git call says where it stalled
domain: host
status: built
priority: medium
created: 2026-11-17
revalidated: 2026-11-17
requires:
  - plans/host/20261117-2149-the-windows-git-cases-stop-flaking/plan.md
problems:
  - problems/git-cases-time-out-on-windows.md
  - problems/a-disposable-machine-case-fails-at-random.md
refs:
  - "[code://packages/sdk/test/worktrees.test.ts#L54-L81](../../../../packages/sdk/test/worktrees.test.ts#L54-L81) - `repository`, seven `execFileSync` git calls before the case's first `await`"
  - "[code://packages/sdk/test/worktrees.test.ts#L839](../../../../packages/sdk/test/worktrees.test.ts#L839) - \"answers the branches a client types for\", three more `git branch` calls before its first `await`"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L76-L84](../../../../packages/sdk/test/changes-refresh.test.ts#L76-L84) - `git` and `repository`, the same synchronous setup, and the `git add` of the changes-refresh case"
  - "[code://packages/computer/test/computer-disposable.test.ts#L1434](../../../../packages/computer/test/computer-disposable.test.ts#L1434) - `repositoryIn`, the synchronous setup of the disposable subfolder case"
  - "[code://packages/sdk/src/repo/hardened.ts#L64-L69](../../../../packages/sdk/src/repo/hardened.ts#L64-L69) - `timed`, the `slow git:` line and its `AHPD_GIT_SLOW_MS` limit, which only `runGit` calls"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`, a test helper in `tools/` that tests import, and the wait that fails before vitest's own timeout"
  - "[code://vitest.config.ts#L34](../../../../vitest.config.ts#L34) - `testTimeout`, 20 s on Windows and 5 s elsewhere"
  - "[code://DEVELOPER.md#L85](../../../../DEVELOPER.md#L85) - what `AHPD_GIT_SLOW_MS` does"
  - https://github.com/ahpio/ahpd/actions/runs/42760023503 - the one failure of the branches case, `windows (3/4)`, attempt 1
---

## Goal

A git call that a test makes itself fails at its own line when it stalls, and names the call.
Today such a call has no timeout and no timing, so a stall shows only as vitest's timeout of the whole case.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

| Case | Failure | Reported after | Git before its first `await` |
| --- | --- | --- | --- |
| worktrees, "answers the branches a client types for" | `Test timed out in 20000ms` | 24.6 s | 10 `execFileSync` calls |
| changes-refresh, "re-reads a changeset when git is changed outside the host" | `Test timed out in 20000ms` | 23.8 s | the `execFileSync` calls of `repository` |
| computer-disposable, "mounts the repository root for a session in a subfolder" | `Test timed out in 20000ms` | 24.6 s | the `execFileSync` calls of `repositoryIn` |

- Vitest times a case out with a timer. A timer that fires 3.8 s to 4.6 s late means that the event loop was blocked at the deadline.
- A synchronous call blocks the event loop, and the setup git calls are the synchronous work of these cases. This is a reading of the timings, not a log line.
- The `slow git:` line of host/20261117-2149 comes from `runGit`. A test's `execFileSync` git call does not go through `runGit`, so a stall there prints nothing.
- The branches case failed once, in run 42760023503. No CI run on 2026-11-16 or 2026-11-17 failed it, and the run of #370 printed no `slow git:` line.

### Searches performed

- `rg "execFileSync\('git'|spawnSync\('git'" packages` - 119 call sites in 23 test files, and three in `packages/computer/src`.
- `gh api .../actions/workflows/ci.yml/runs` - the CI runs that failed or ran again since 2026-11-16; none failed the branches case.
- `ls eslint.config.*` - the repository has no lint config, and its static checks are scripts and test cases.

### Gaps

- A test's own git call has no timeout and no `slow git:` line.
- Nothing stops a new test from calling git directly.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A shared test helper runs each test git call with a timeout and a `slow git:` line, so a stall fails at its own call and names it | Softov, 2026-11-17: "Fail fast, name the call" | 01 |
| Every test file that runs git synchronously moves to the helper, and a check stops a new direct call | Softov, 2026-11-17: "All 23 test files" | 02 |
| The helper is `gitSync` in `tools/git.ts`, beside `tools/wait.ts` | (defaulted: `tools/` holds the suite's shared test helpers) | 01 |
| A call's timeout is `WAIT_MS` unless the caller gives one | (defaulted: `WAIT_MS` is the suite's wait that fails in its own words before vitest's timeout) | 01 |
| The helper writes its line with `timed` from `hardened.ts` | (defaulted: one line format for host and test calls) | 01 |
| The check is a case in the helper's own test file that reads every test file | (defaulted: the repository has no lint, and its static checks are scripts and cases) | 02 |
| A `spawnSync` setup call moves to `gitSync` too, so a setup call that fails throws | (defaulted: a setup call that fails without a word hides the failure from the case) | 02 |
| The three `spawnSync` calls in `packages/computer/src` and the script `tools/ahp-test-cases.mjs` stay as they are | (defaulted: they are product code and a script, not test files) | - |
| No retry of a stalled call | Softov, 2026-11-17: "Fail fast, name the call" | - |

## Proposed architecture

- **Data flow** - a test calls `gitSync(args, options)`, which runs `execFileSync('git', args)` with a timeout, times it, and returns its output as a string.
- **Event flow** - a call over `AHPD_GIT_SLOW_MS` writes a `slow git:` line to stderr. A call over its timeout throws an error that names the call.
- **Layer responsibilities** - tools: `git.ts` · sdk: `hardened.ts` exports `timed` · tests: 23 files in `packages/sdk/test` and `packages/computer/test` · docs: `DEVELOPER.md`.
- **Source-of-truth files** - `code://tools/git.ts`, made by task 01.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a test git call has a timeout and a line](task-01-a-test-git-call-has-a-timeout.md) | done | - |
| [02 - every test runs git through gitSync](task-02-every-test-runs-git-through-gitsync.md) | done | 01 |

## Risks and tradeoffs

- The branches case can still fail - its next stall fails at the call and names it, and that line decides the fix.
- A setup call over `WAIT_MS` on a busy machine fails at the call - vitest's timeout fails that case a second later anyway.
- A `spawnSync` setup call that fails today without a word throws after task 02 - that case was asserting against a setup it did not have.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 and 02 are `implemented` on 2026-11-17, on the branch `host/20261117-2336-a-test-git-call-says-where-it-stalled`.
- **Next action:** Softov's review; the next Windows stall of a test's own git call is the check.
- **Open questions:** none.
- **Watch out for:** a CI run that stays green proves nothing; the check is the line that the next stall prints.

## Final verification checklist

- [x] `rg "execFileSync\('git'|spawnSync\('git'" packages/*/test` finds nothing.
- [x] The sdk and computer suites pass, and `check-windows` is green.
- [x] A run with `AHPD_GIT_SLOW_MS=1` prints a `slow git:` line for a test's own git call.
