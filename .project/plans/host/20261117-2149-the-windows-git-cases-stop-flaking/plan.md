---
title: The Windows git cases stop failing at random
domain: host
status: built
priority: medium
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - "[code://.project/problems/git-cases-time-out-on-windows.md](../../../problems/git-cases-time-out-on-windows.md) - the cases, their failures, and the third one fixed by host/20261113-2331"
  - "[code://packages/sdk/src/sessions/changes.ts#L1982-L2108](../../../../packages/sdk/src/sessions/changes.ts#L1982-L2108) - the git watch, armed only after two `git rev-parse` processes"
  - "[code://packages/sdk/test/changes-refresh.test.ts#L217](../../../../packages/sdk/test/changes-refresh.test.ts#L217) - \"re-reads a changeset when git is changed outside the host\", which runs `git add` 8 turns after the subscribe"
  - "[code://packages/sdk/test/worktrees.test.ts#L1263-L1270](../../../../packages/sdk/test/worktrees.test.ts#L1263-L1270) - `logged`, a fixed 400 tries of 10 ms"
  - "[code://packages/sdk/test/worktrees.test.ts#L1346](../../../../packages/sdk/test/worktrees.test.ts#L1346) - \"takes away and puts back a tree a move left the session\""
  - "[code://packages/sdk/test/worktrees.test.ts#L839](../../../../packages/sdk/test/worktrees.test.ts#L839) - \"answers the branches a client types for\", whose one failure left no log"
  - "[code://packages/sdk/src/repo/hardened.ts#L49-L62](../../../../packages/sdk/src/repo/hardened.ts#L49-L62) - `runGit`, which every git call of the sdk goes through"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`, the suite's wait by the clock"
---

## Goal

The three git cases that fail at random on Windows stop failing, or say why the next time they fail.
Each has its own cause, read from the code and from the timings of 17 passing `windows (3/4)` runs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

| Case | Passing runs | Failure | Cause |
| --- | --- | --- | --- |
| changes-refresh, "re-reads a changeset when git is changed outside the host" | 0.9 s to 2.8 s | 23.8 s, timeout | unknown; the host already reads again once the watch is armed |
| worktrees, "takes away and puts back a tree a move left the session" | 2.6 s to 9.6 s | 20.6 s, `never logged` | its git work outgrew the 20 s budget on a slow runner |
| worktrees, "answers the branches a client types for" | 0.5 s to 1.2 s | 24.6 s, timeout | unknown; no log of the failed run survives |

### Searches performed

- `gh run view` over the last 30 CI runs - the times of each case in every `windows (3/4)` log that is kept.
- `rg "runGit" packages/sdk/src` - every git call of the sdk goes through `runGit`.

### Gaps

- `logged` waits a fixed number of tries, where the suite waits by `WAIT_MS`.
- No log says which git call was slow.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The changes-refresh case is treated as the branches case: kept in the problem file, named by the slow-git line | Softov, 2026-11-17: "Treat it like the branches case" | 03 |
| `logged` waits by `WAIT_MS`, and the moved-tree case has 60 s on Windows | Softov, 2026-11-17: "Wait by the clock, bigger budget" | 02 |
| Each git call over 2 s is logged at debug level, with its arguments and its time | Softov, 2026-11-17: "Log each git call's time" | 03 |
| The slow call also goes to stderr where `AHPD_GIT_SLOW_MS` is set, and the Windows CI jobs set it to 2000 | (defaulted: nothing prints a test host's log on CI, and the next failure has to name the call) | 03 |
| The branches case stays in the problem file until it fails again | Softov, 2026-11-17: "Log each git call's time" | 03 |
| No change to the git watch: `facts.ts` reads a directory again once its watch is armed | [code://packages/sdk/src/host/facts.ts#L694-L701](../../../../packages/sdk/src/host/facts.ts#L694-L701) | - |

## Proposed architecture

- **Data flow** - `runGit` times each call from start to close, and says one over the limit to its listener.
- **Layer responsibilities** - sdk: `hardened.ts`, `host.ts` · tests: `changes-refresh.test.ts`, `worktrees.test.ts` · CI: the Windows jobs' env.
- **Source-of-truth files** - [`code://packages/sdk/src/repo/hardened.ts`](../../../../packages/sdk/src/repo/hardened.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the git watch reads once when armed](task-01-the-git-watch-reads-once-when-armed.md) | dropped | - |
| [02 - the moved-tree case waits by the clock](task-02-the-moved-tree-case-waits-by-the-clock.md) | done | - |
| [03 - a slow git call says so](task-03-a-slow-git-call-says-so.md) | done | - |

## Risks and tradeoffs

- The moved-tree case may take up to 60 s on a slow Windows runner - the archive work is not made faster here.
- The changes-refresh and branches cases are not fixed - their next failure names a slow git call, if one stalled.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** task 01 is `dropped`, and tasks 02 and 03 are `implemented` on 2026-11-17, on the branch `host/20261117-2149-the-windows-git-cases-stop-flaking`.
- **Next action:** Softov's review; the CI runs after the merge are the check.
- **Open questions:** none.
- **Watch out for:** a case that is green once on Windows proves little; the CI runs after the merge are what count.

## Final verification checklist

- [x] The sdk and computer suites pass, and `check-windows` is green.
- [x] A run with `AHPD_GIT_SLOW_MS=1` prints a slow-git line to stderr for a case that runs git.
