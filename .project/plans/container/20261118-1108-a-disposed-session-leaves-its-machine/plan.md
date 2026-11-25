---
title: A disposed session leaves its machine
domain: container
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://e4aa35c20 - the last commit that holds the problem a-disposed-session-not-held-leaves-its-machine.md, which this plan fixes
  - "[code://packages/sdk/src/host/lifecycle.ts#L851-L858](../../../../packages/sdk/src/host/lifecycle.ts#L851-L858) - the branch of `removeSession` for a session not held, which forgets the row and never lets its machine go"
  - "[code://packages/sdk/src/host/catalogue.ts#L1505-L1517](../../../../packages/sdk/src/host/catalogue.ts#L1505-L1517) - the prune of forgotten rows, which reads the config before the row goes and then calls `leaveForgotten`: the pattern"
  - "[code://packages/sdk/src/host/machines.ts#L414](../../../../packages/sdk/src/host/machines.ts#L414) - `leaveForgotten`, which tells the port a forgotten session left its machine"
  - "[code://packages/sdk/test/computer-bringback.test.ts#L64](../../../../packages/sdk/test/computer-bringback.test.ts#L64) - a port that records each `leave`, the shape of the new case"
---

## Goal

A client disposes a session that this process does not hold, and its disposable machine is let go as for a held session.
So a dispose after a restart leaves no container behind.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- A held session's teardown lets its machine go.
- A session not held goes through the `held === undefined` branch, which forgets the chats, the kept row and the owner, and calls nothing on the port.
- An adopted machine starts with the session's label in its set, so the set never empties and the machine stays.
- The catalogue prune reads `kept.config(id)` before it forgets the row, and calls `ctx.leaveForgotten` after.

### Searches performed

- `rg -n "kept.forget" packages/sdk/src/host/lifecycle.ts` - three places forget a row. Only the dispose of a session not held misses a `leave`: the teardown lets the machine go, and a failed create entered none.
- `rg -n "leaveForgotten" packages/sdk/src` - the catalogue prune is its one caller.

### Gaps

- A dispose of a session not held never tells the port that the session left.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The branch reads the config before `kept.forget`, and calls `ctx.leaveForgotten` with it after the row goes | (defaulted: the problem's first fix, the same shape as the prune) | 01 |
| `kept.forget` keeps its shape | (defaulted: the problem's second fix moves every forget for one caller that needs it) | 01 |

## Proposed architecture

- **Data flow** - `removeSession` reads the session's config, forgets the row, and hands both to `leaveForgotten`, which tells the port.
- **Layer responsibilities** - sdk: `host/lifecycle.ts` · docs: the notes.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a dispose not held lets the machine go](task-01-a-dispose-not-held-lets-the-machine-go.md) | done | - |

## Risks and tradeoffs

- A session in no machine reads a config with no `computer`, and `leaveForgotten` asks nothing of the port.

## Resume state

- **Done so far:** task 01. The cases list the session on a second host over the same store and backend, then dispose it unopened.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** read the config before `kept.forget`, as the prune does; after it the config is gone.

## Final verification checklist

- [ ] The new case sees `leave` for a session disposed while not held.
- [ ] The sdk and computer suites pass, one at a time, and `check` and `check-windows` are green.
