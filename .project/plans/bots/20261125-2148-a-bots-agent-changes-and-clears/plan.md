---
title: A bot's agent changes and its fields clear
domain: bots
status: active
priority: high
created: 2026-11-25
revalidated: 2026-11-25
changes:
  - specs/bots.md
refs:
  - git://e06dbc28f - main when the plan was made
  - "[code://packages/bot/src/record.ts#L212-L217](../../../../packages/bot/src/record.ts#L212-L217) - `line`, which reads a blank as absent"
  - "[code://packages/bot/src/record.ts#L296-L355](../../../../packages/bot/src/record.ts#L296-L355) - `checkRecord`, which keeps the old value for an absent field"
  - "[code://packages/bot/src/wake.ts#L439-L478](../../../../packages/bot/src/wake.ts#L439-L478) - `backOf`, which continues the Back it finds without comparing agents"
  - "[code://packages/bot/src/plugin.ts#L716-L732](../../../../packages/bot/src/plugin.ts#L716-L732) - `backChat`, which finds the first chat whose origin names the Front"
  - "[code://packages/bot/src/names.ts#L178-L212](../../../../packages/bot/src/names.ts#L178-L212) - `frontSessions`, the pattern for rows kept for each bot"
  - "[code://packages/bot/package.json](../../../../packages/bot/package.json) - the options schema"
---

## Goal

A person can set a bot back to the default agent, model, preset or computer, and can empty its description and instructions. When a person changes the agent or the model of a bot, the next message of an open talk uses it. Today a blank keeps the old value, and an open talk keeps its old Back.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "backChat|backOf" packages/bot/src` - one reader and one writer; nothing records what a Back was started on.
- `.project/plans/bots` - the open drafts change the machine, the tools and the folder of a bot, and none changes `backOf` or `checkRecord`.

### Runtime path

```
x-ahpd/bots/put -> checkRecord -> record
message in the Front -> backOf -> the Back row of this Front, compared with the record -> the same Back, or a new one
```

### Gaps

- A field cannot be cleared by an edit.
- Nothing records the agent and model a Back was started on.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin option decides what an agent or model change does: `new`, the default, starts a Back on it, and `keep` continues the old Back | Softov, 2026-11-25, chose "Setting, default new Back" | 02 |
| The option is `agentChange` | (defaulted: it names what changes) | 02 |
| A blank `provider`, `model`, `preset`, `computer`, `template`, `description` or `instructions` clears the field, and an absent one keeps it | (defaulted: ahpw already sends a blank to clear, and the form needs it) | 01 |
| A blank `name` stays as today | (defaulted: a bot has a name) | 01 |
| The comparison is on `preset`, else `provider`, and on `model`, as the record names them | (defaulted: a change of the host's default is not an edit of the bot) | 02 |
| A Back with no row, from before this plan, is adopted with the record as it is | (defaulted: an upgrade must not cut a talk) | 02 |
| A change waits while the old Back runs a turn or a Front turn waits on it | (defaulted: a steer and an answer belong to the Back that runs) | 02 |
| A second Back does not end the first, which stays readable | Softov, 2026-11-25, the text of "Setting, default new Back" | 02 |

## Proposed architecture

- **Data flow** - `checkRecord` tells a blank from an absent field. A row for each Front keeps `chat`, `provider` and `model` of its current Back.
- **Event flow** - unchanged; a new Back is a `startChat` with the same origin kind.
- **State flow** - the rows are under `<configDir>/bots/<slug>/`, so a delete of the bot removes them.
- **Layer responsibilities** - bot: all of it.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a blank clears a field](task-01-a-blank-clears-a-field.md) | done | - |
| [02 - a changed agent gets a new Back](task-02-a-changed-agent-gets-a-new-back.md) | done | - |

## Risks and tradeoffs

- A client that sent a blank to keep a value now clears it. The release notes say so in Upgrading.
- The new Back does not know the talk before it. The Front still shows it, and `keep` is the other choice.

## Resume state

- **Done so far:** both tasks, on 2026-11-25. [implemented.md](implemented.md) holds the checks.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** two Backs of one Front have the same origin kind, so `backChat` cannot tell the current one by itself.

## Final verification checklist

- [ ] A bot goes from an agent back to the default, and its instructions can be emptied.
- [ ] An agent change reaches the next message of an open talk, also after a restart.
- [ ] With `keep`, the old Back continues.
- [ ] `pnpm typecheck` and the bot and webhook suites pass.
