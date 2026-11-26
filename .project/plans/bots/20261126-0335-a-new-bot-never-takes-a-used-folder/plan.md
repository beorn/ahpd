---
title: A new bot never takes a used folder
domain: bots
status: active
priority: high
created: 2026-11-26
revalidated: 2026-11-26
changes:
  - specs/bots.md
refs:
  - git://ee3c2476c - main when the plan was made, and the last commit that holds the problem file `a-new-bot-writes-over-another-hosts-bot-folder.md`
  - "[code://packages/bot/src/provider.ts#L489-L505](../../../../packages/bot/src/provider.ts#L489-L505) - `workspaceFor`, which looks for a clash among this host's bots only"
  - "[code://packages/bot/src/provider.ts#L710-L722](../../../../packages/bot/src/provider.ts#L710-L722) - a make that finds an `AGENTS.md` writes its parts into it"
  - "[code://packages/bot/src/record.ts#L24-L25](../../../../packages/bot/src/record.ts#L24-L25) - `ALREADY_EXISTS`, the code of the refusal"
---

## Goal

A new bot never writes into a folder that already has files, unless the make names that folder. Today a bot made on one host can write over the `AGENTS.md` of a bot of another host that uses the same root. On 2026-11-25 a test host lost the persona of Softov's bot `goo` this way.

## Reconnaissance

The files read are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "already there|finds a file" packages/bot` - a make into an existing `AGENTS.md` is written on purpose, and no test makes a bot in a folder with files.
- `.project/plans/bots` - the open drafts change a bot on a computer and a manager bot's edits. Neither changes the make check.
- ahpw `makeBot` tries the next slug when a make is refused with `AlreadyExists`.

### Runtime path

```
x-ahpd/bots/put (make) -> workspaceFor -> the folder has files and the make names none -> refused with -32010
x-ahpd/bots/put (make) -> workspaceFor -> the make names the folder -> the file there gets the new parts, as today
```

### Gaps

- A make checks the bot store, not the folder on disk.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A make with the default folder is refused when that folder has files. A make that names the folder takes it, as today | Softov, 2026-11-26, chose "Refuse a folder with files" | 01 |
| The refusal is `-32010`, already exists | (defaulted: ahpw's form moves to the next slug on that code) | 01 |
| An empty folder is not a used folder | (defaulted: nothing in it can be lost) | 01 |
| A bot on a computer is not checked | (defaulted: its folder is not on this host) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A make refuses a folder with files](task-01-a-make-refuses-a-folder-with-files.md) | done | - |

## Risks and tradeoffs

- A person who remakes a bot over its old folder after a lost store must now name the folder.
- A client other than ahpw that tries one slug only gets the refusal and must offer another slug.

## Resume state

- **Done so far:** task 01, on 2026-11-26. [implemented.md](implemented.md) holds the checks.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** the refusal must come before the file is read or written, so a refused make leaves the folder as it was.

## Final verification checklist

- [ ] Two hosts share one root. A make on the second with a slug of the first is refused.
- [ ] The first bot's `AGENTS.md` is unchanged.
- [ ] ahpw makes the bot under the next slug.
- [x] `pnpm typecheck` and the bot and webhook suites pass.
