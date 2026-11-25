---
title: A slow git call says so
status: done
depends: []
layer: "sdk, CI"
refs:
  - "[code://packages/sdk/src/repo/hardened.ts#L49-L62](../../../../packages/sdk/src/repo/hardened.ts#L49-L62) - `runGit`"
  - "[code://.github/workflows/ci.yml#L96](../../../../.github/workflows/ci.yml#L96) - the Windows jobs"
---

## Objective

The host logs a git call that takes over 2 s at debug level.
The Windows CI jobs print it, so the next failure names the call.

## Files

- `UPDATE: packages/sdk/src/repo/hardened.ts:49-62` - `runGit` times each call, and `onSlowGit` sets who hears a slow one.
- `UPDATE: packages/sdk/src/host.ts` - `createHost` sets the listener to its log at debug level.
- `UPDATE: .github/workflows/ci.yml` - the Windows test jobs set `AHPD_GIT_SLOW_MS` to 2000.
- `UPDATE: packages/sdk/test/git-hardened.test.ts` - the slow-call cases.
- `UPDATE: .project/problems/git-cases-time-out-on-windows.md` - the fixed cases out, the branches case kept.

## Steps

1. Time each `runGit` call from its start to its close.
2. Say a call over 2 s to the `onSlowGit` listener, with the folder, the arguments and the milliseconds.
3. Also write the line to stderr for a call that outlasts `AHPD_GIT_SLOW_MS`, if the variable exists.
4. Set the listener in `createHost` to `log.debug`.
5. Set `AHPD_GIT_SLOW_MS: 2000` on the Windows test jobs in `ci.yml`.
6. Remove the fixed cases from the problem file, and keep the branches case with this plan named.

## Validation

- A test: a git call slower than the limit is said once, with its arguments; a fast one is not.
- A test: with `AHPD_GIT_SLOW_MS` set, the line goes to stderr.
- Run the sdk suite as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`runGit` times each call from its start to its close, and says a slow one to `onSlowGit` and to stderr.
`createHost` points the listener at `log.debug`; the last host made in a process is the one that hears.
The tests stand in for the clock, so `git --version` reads as slow or fast as a case needs.
`DEVELOPER.md` says what `AHPD_GIT_SLOW_MS` does, beyond the task's files.
The first Windows run after the merge printed one `slow git:` line, made by the first case's stood-in clock under the job's `AHPD_GIT_SLOW_MS`.
A follow-up clears the variable in the cases that stand in for it, so the job's log holds only real calls.
