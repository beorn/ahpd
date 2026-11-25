---
title: gone waits 20 s for a stopped daemon
status: done
depends: []
layer: "tests"
refs:
  - "[code://packages/server/test/cli.ts#L144-L148](../../../../packages/server/test/cli.ts#L144-L148) - `gone`, the wait this task changes"
---

## Objective

`gone` waits up to 20 s for a pid to leave, and its comment says why.

## Files

- `UPDATE: packages/server/test/cli.ts:144-148` - `gone` waits up to 20 s, with a named constant and a comment.
- `DELETE: .project/problems/the-daemon-restart-case-waits-5-s-for-the-old-pid.md` - this task fixes it.

## Steps

1. Add a constant `GONE_MS = 20_000` in `cli.ts`, beside `gone`.
2. Make `gone` wait until `Date.now() + GONE_MS`, and keep its 50 ms poll.
3. Write in the comment that a restart spends 3 s of the wait on `restartDelayMs`.
4. Write in the comment that the 20 s match the wait for the successor in the restart case.
5. Delete the problem file.

## Validation

- `rg "Date.now\(\) \+ 5000" packages/server/test/cli.ts` finds nothing.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

Built on 2026-11-18, as the steps say.

