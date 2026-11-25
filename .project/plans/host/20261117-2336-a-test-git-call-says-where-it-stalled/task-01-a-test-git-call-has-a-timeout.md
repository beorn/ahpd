---
title: A test git call has a timeout and a slow-git line
status: done
depends: []
layer: "tools"
refs:
  - "[code://packages/sdk/src/repo/hardened.ts#L64-L69](../../../../packages/sdk/src/repo/hardened.ts#L64-L69) - `timed`, which this task exports for the helper"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`, the default timeout, and the shape of a helper in `tools/`"
  - "[code://packages/sdk/test/git-hardened.test.ts](../../../../packages/sdk/test/git-hardened.test.ts) - `withSlowLimit`, how a case sets `AHPD_GIT_SLOW_MS` and puts it back"
---

## Objective

`gitSync` in `tools/git.ts` runs one git call for a test, with a timeout and a `slow git:` line.

## Files

- `CREATE: tools/git.ts` - `gitSync(args, options)`, a test's own synchronous git call.
- `UPDATE: packages/sdk/src/repo/hardened.ts:64-69` - export `timed`, and say in its comment that test calls use it too.
- `CREATE: packages/sdk/test/test-git.test.ts` - the cases of `gitSync`.

## Steps

1. Export `timed` from `packages/sdk/src/repo/hardened.ts`, with no change to its line or its limits.
2. Write `gitSync(args: readonly string[], options?: ExecFileSyncOptions): string` in `tools/git.ts`.
3. Make `gitSync` call `execFileSync('git', args)` with `stdio: 'pipe'`, `timeout: WAIT_MS` and `windowsHide: true`, then the caller's options.
4. Make `gitSync` return the output as a UTF-8 string.
5. Make `gitSync` give `timed` the time of each call, with `options.cwd` as the folder or `-` when there is none.
6. Make `gitSync` catch an error with code `ETIMEDOUT` and throw `git <args> did not finish in <timeout> ms`.
7. Let every other error of `execFileSync` through as it is, so a case still reads git's own stderr.
8. Add a case to `test-git.test.ts`: `gitSync(['--version'])` returns a line that starts with `git version`.
9. Add a case: with `AHPD_GIT_SLOW_MS=1`, a call writes one `slow git:` line to stderr that names its arguments.
10. Add a case: a call with `timeout: 1` throws an error that names the call and `1 ms`.

## Validation

- `packages/sdk/test/test-git.test.ts` holds the cases of steps 8 to 10.
- `TMPDIR=/home/softov/tmp/ahpd-test timeout 1500 flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/sdk/test/test-git.test.ts` passes.
- `pnpm typecheck` passes.

## Resume

Built on 2026-11-17. A 1 ms timeout stopped `git --version` in 300 of 300 runs on Linux, so the timeout case does not depend on a fast machine.

