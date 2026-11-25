---
title: The Windows git cases stop failing at random - implemented
date: 2026-11-18
refs:
  - git://08a1c1d9d - the merge of #369
  - git://bf25d35b9 - the merge of #370
---

The three git cases that fail at random on Windows stop failing, or say why the next time they fail.
Each has its own cause, read from the code and from the timings of 17 passing `windows (3/4)` runs.

## What was built

- [`code://packages/sdk/src/sessions/changes.ts`](../../../../packages/sdk/src/sessions/changes.ts) - `ready` fires the change once, after the directories are watched.
- [`code://packages/sdk/test/changes-refresh.test.ts`](../../../../packages/sdk/test/changes-refresh.test.ts) - a change made before the watch is armed.
- [`code://packages/sdk/test/worktrees.test.ts`](../../../../packages/sdk/test/worktrees.test.ts) - `logged` waits until `WAIT_MS` has passed.
- [`code://packages/sdk/src/repo/hardened.ts`](../../../../packages/sdk/src/repo/hardened.ts) - `runGit` times each call, and `onSlowGit` sets who hears a slow one.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `createHost` sets the listener to its log at debug level.
- [`code://.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) - the Windows test jobs set `AHPD_GIT_SLOW_MS` to 2000.
- [`code://packages/sdk/test/git-hardened.test.ts`](../../../../packages/sdk/test/git-hardened.test.ts) - the slow-call cases.

## Verified

- The sdk and computer suites pass, and `check-windows` is green.
- A run with `AHPD_GIT_SLOW_MS=1` prints a slow-git line to stderr for a case that runs git.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #369 and #370.

## Departures from the plan

- Task 01 is dropped: Dropped on 2026-11-17, before anything merged.
- The host already reads a directory again once its watch says it is armed, in `facts.ts:694-701`, and two cases test it.
- The race this task named does not exist, so the answer that chose it rested on a wrong reading.
- Softov chose to treat the case as the branches case.
- `logged` polls every 25 ms until `WAIT_MS`, and looks once more before it fails.
- The case takes 370 ms on this machine; its Windows budget is 60 s.
- `runGit` times each call from its start to its close, and says a slow one to `onSlowGit` and to stderr.
- `createHost` points the listener at `log.debug`; the last host made in a process is the one that hears.
- The tests stand in for the clock, so `git --version` reads as slow or fast as a case needs.
- `DEVELOPER.md` says what `AHPD_GIT_SLOW_MS` does, beyond the task's files.
- The first Windows run after the merge printed one `slow git:` line, made by the first case's stood-in clock under the job's `AHPD_GIT_SLOW_MS`.
- A follow-up clears the variable in the cases that stand in for it, so the job's log holds only real calls.

## Left for later

- The changes-refresh case and the branches case still fail at random on Windows - [git-cases-time-out-on-windows.md](../../../problems/git-cases-time-out-on-windows.md) waits for a stall to name its call.
