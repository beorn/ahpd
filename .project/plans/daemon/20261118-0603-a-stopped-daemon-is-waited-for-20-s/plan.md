---
title: A stopped daemon is waited for 20 s
domain: daemon
status: built
priority: medium
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://6a5eafe36 - the last commit that holds the problem the-daemon-restart-case-waits-5-s-for-the-old-pid.md, which this plan fixes
  - "[code://packages/server/test/cli.ts#L144-L148](../../../../packages/server/test/cli.ts#L144-L148) - `gone`, a fixed wait of 5 s for a pid to leave"
  - "[code://packages/server/test/server-cli-restart.test.ts#L13-L46](../../../../packages/server/test/server-cli-restart.test.ts#L13-L46) - the restart case: `restartDelayMs: 3000`, then `gone`, then 20 s for the successor, in a budget of 60 s"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`, 4 s off Windows, shorter than the 5 s of today"
---

## Goal

The server cases that wait for a stopped daemon to leave give it 20 s, so a busy machine does not fail them.
Today the wait is 5 s, and a restart spends 3 s of it on its own delay before it starts to stop.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- On 2026-11-17 the restart case failed at a load average near 14: the old daemon was still alive after `gone`.
- The same file passed twice alone on the same commit.
- `gone` has 15 callers in 7 files, and each case that calls it has a budget of 60 s or more.

### Searches performed

- `rg "gone\(" packages/server/test` - 15 callers, in `cli.ts`, `join.test.ts`, `server-cli.test.ts`, `server-cli-start.test.ts`, `server-cli-service.test.ts`, `server-cli-restart.test.ts` and `tunnels.test.ts`.

### Gaps

- `gone` waits 5 s whatever the case is doing, and a restart uses 3 s of it before the old daemon starts to stop.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `gone` waits up to 20 s, the time the restart case gives its successor | Softov, 2026-11-18: "20 s, as the successor wait" | 01 |
| Not `WAIT_MS`: it is 4 s off Windows, shorter than the 5 s of today | [code://tools/wait.ts](../../../../tools/wait.ts) | - |
| One number in `gone`, and no caller passes its own | (defaulted: the 15 callers wait for the same thing) | 01 |

## Proposed architecture

- **Data flow** - `gone(pid)` polls `alive(pid)` every 50 ms for up to 20 s, as today with a longer bound.
- **Layer responsibilities** - tests: `packages/server/test/cli.ts`.
- **Source-of-truth files** - [`code://packages/server/test/cli.ts`](../../../../packages/server/test/cli.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - gone waits 20 s](task-01-gone-waits-20-s.md) | done | - |

## Risks and tradeoffs

- A daemon that never leaves costs 20 s before its case fails - each budget is 60 s or more.

## Resume state

- **Done so far:** task 01 is `implemented` on 2026-11-18, on the branch `daemon/20261118-0603-a-stopped-daemon-is-waited-for-20-s`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** a green run proves little; the case failed only on a busy machine.

## Final verification checklist

- [ ] The server suite passes, and `check` and `check-windows` are green.
- [ ] `rg "Date.now\(\) \+ 5000" packages/server/test/cli.ts` finds nothing.
