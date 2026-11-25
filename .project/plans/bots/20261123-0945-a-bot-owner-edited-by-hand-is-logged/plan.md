---
title: A bot owner edited by hand is taken and logged
domain: bots
status: built
priority: medium
created: 2026-11-23
revalidated: 2026-11-23
refs:
  - git://e68555ee0 - the last commit that holds `problems/a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md`, which this plan fixes
  - git://e68555ee0 - main when the plan was written
  - "[code://packages/bot/src/store.ts#L222-L234](../../../../packages/bot/src/store.ts#L222-L234) - a running store refuses an owner change from the file, and keeps the old owner"
  - "[code://packages/bot/src/store.ts#L85-L92](../../../../packages/bot/src/store.ts#L85-L92) - `kept` reads a record, `createdAt` and `updatedAt` among its fields"
  - "[code://packages/bot/src/record.ts#L104](../../../../packages/bot/src/record.ts#L104) - `updatedAt`, which a client's etag reads"
  - "[code://packages/bot/test/bot-store.test.ts](../../../../packages/bot/test/bot-store.test.ts) - the case of the refused owner change, which this plan turns over"
  - "[plans/daemon/22-a-plugins-late-problem-is-logged/plan.md](../../daemon/22-a-plugins-late-problem-is-logged/plan.md) - a plugin's late `problem` line reaches the daemon log, built"
---

## Goal

The bot's file is the truth for its owner. A hand edit of `owner` is taken while the daemon runs, as a restart already takes it, and the daemon logs the change. A client sees the change, because `updatedAt` moves.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "owner" packages/bot/src/store.ts` - the one owner check is the refusal at line 224.
- `rg "updatedAt" packages/bot/src` - a hand edit keeps the file's `updatedAt`.

### Runtime path

```
hand edit of bots/<slug>.md -> records watch -> store change handler -> owner differs -> onProblem, old owner kept
restart -> load reads the file -> the file's owner
```

### Gaps

- The running daemon and a restart give two answers for one file.
- A taken hand edit keeps the old `updatedAt`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The file is the truth: a hand edit of `owner` is taken, and logged | Softov, 2026-11-23: "The file, with a log line" | 01 |
| The log line is `bots/<id> owner changed from <old> to <new> by an edit of its file`, through `onProblem` | (defaulted: `onProblem` reaches the daemon log since daemon/22) | 01 |
| `updatedAt` takes the time the store heard the change | (defaulted: the problem says the file's change time, and the record store gives no file time; the time the change is heard stands for it) | 01 |
| A change made while the daemon is stopped is taken at the next load with no line | (defaulted: a restart has no earlier owner to compare with, and the file is the truth) | 01 |
| A hand edit of `workspace` stays refused | (defaulted: not part of the problem) | 01 |

## Proposed architecture

- **Data flow** - the change handler takes the file's owner, sets `updatedAt`, and keeps the bot.
- **Event flow** - the store's `heard` sends `updated` with the new owner, as for any other field.
- **State flow** - unchanged.
- **Layer responsibilities** - bot: the store.
- **Source-of-truth files** - [`code://packages/bot/src/store.ts`](../../../../packages/bot/src/store.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a hand edit of owner is taken](task-01-a-hand-edit-of-owner-is-taken.md) | done | - |

## Risks and tradeoffs

- Whoever can write the configuration folder can move a bot. That person already controls the daemon, and the change is now logged.
- A session a bot's old owner talks in keeps running; the talk rows follow the new owner from the next start.

## Resume state

- **Done so far:** task 01, on 2026-11-23. [implemented.md](implemented.md) holds the checks.
- **Next action:** none. `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** the store writes the record back when `updatedAt` changes; that write must not be heard as a second hand edit.

## Final verification checklist

- [ ] A hand edit of `owner` on a running daemon is taken, logged once, and moves `updatedAt`.
- [ ] A restart gives the same owner.
- [ ] The bot suite passes.
