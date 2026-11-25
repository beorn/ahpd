---
title: A plugin's late problem is logged
domain: daemon
status: built
priority: medium
created: 2026-10-13
revalidated: 2026-10-13
refs:
  - "[code://packages/server/src/plugins.ts#L856-L897](../../../../packages/server/src/plugins.ts#L856-L897) - `told`, which keeps each `problem` line for the load's answer"
  - "[code://packages/server/src/plugins.ts#L905-L941](../../../../packages/server/src/plugins.ts#L905-L941) - the three answers that read `told` when `apply` returns"
  - "[code://packages/bot/src/store.ts#L185-L198](../../../../packages/bot/src/store.ts#L185-L198) - the bot store, which says a refused hand edit through `problem` after `apply`"
---

## Goal

A line that a plugin says through `problem` after its `apply` returned reaches the daemon log at once.
Today such a line goes to `told`, which nobody reads again, so the line is lost.
Found while checking plugin/45 p2 on 2026-10-13: a bot file edited by hand to a new owner was refused, and the log showed nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "told" packages/server/src/plugins.ts` - `told` is read only in the three answers of the load.

### Runtime path

```
plugin problem(line) -> told.push -> (during apply) load answer -> log | (after apply) nothing
```

### Gaps

- After `apply` returns, a `problem` line has no reader.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A `problem` line said after `apply` returned is logged at once, as the loader's own lines are | Softov, 2026-10-13, chose "Bot problem log line" for the next fix plans | 01 |

## Proposed architecture

- **Data flow** - `problem` pushes to `told` while the load runs. After the load answered, it writes the line where the daemon writes the load's problems.
- **Layer responsibilities** - server: `plugins.ts`, and the caller that passes the writer.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A late problem line goes to the log](task-01-a-late-problem-line-goes-to-the-log.md) | done | - |

## Risks and tradeoffs

- A plugin that says the same problem on every file event fills the log. The bot store says one line per refused edit, which is the rate a person edits.

## Resume state

- **Done so far:** nothing.
- **Checked by hand:** on Linux, 2026-10-15, at `3cf1dc13`. After a client reads `bot://`, a bot file edited by hand to a new owner gives `bot: bots/boozi-2 changed owner; the bot was left as it was` in the daemon log. Before anything reads the bots, the store is not loaded. An edit made then becomes the bot's first state, with no refusal.
- **Next action:** none. Built 2026-10-15; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the bot's owner after a restart is not this plan, see [the problem](../../bots/20261123-0945-a-bot-owner-edited-by-hand-is-logged/plan.md).

## Final verification checklist

- [x] A bot file edited by hand to a new owner gives a line in the daemon log.
- [x] `plans/index.md` updated.
