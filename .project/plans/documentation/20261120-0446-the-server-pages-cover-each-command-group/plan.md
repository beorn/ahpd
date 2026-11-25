---
title: The server pages cover each command group
domain: documentation
status: built
priority: high
created: 2026-11-20
revalidated: 2026-11-20
requires: []
changes: []
creates: []
decisions: []
refs:
  - git://410725dba - the last commit that holds the brief `briefs/the-server-pages-cover-each-command-group.md`, which this plan covers
  - "[code://docs/server/VAULT.md](../../../../docs/server/VAULT.md) - the shape a new page copies: an example, the command table, then a section per subject"
  - "[code://docs/server/USERS.md#L13-L36](../../../../docs/server/USERS.md#L13-L36) - the one line on `ahpd team` and `ahpd project`"
  - "[code://docs/plugins/COMPUTERS.md#L428-L490](../../../../docs/plugins/COMPUTERS.md#L428-L490) - *Joined nodes*, which links the new nodes page for the commands"
  - "[code://docs/sdk/AUTOMATIONS.md#L199-L355](../../../../docs/sdk/AUTOMATIONS.md#L199-L355) - where an automation is kept, its commands and its files, for a developer"
  - "[code://docs/server/PLUGINS.md](../../../../docs/server/PLUGINS.md) - the plugin commands, without `available`, `apply` and `reload`"
  - "[code://docs/.vitepress/config.mts#L22-L42](../../../../docs/.vitepress/config.mts#L22-L42) - the Server group of the sidebar"
  - "[code://docs/README.md](../../../../docs/README.md) - the index, with the `server` table"
  - "[code://packages/server/src/commands/nodes.ts#L166](../../../../packages/server/src/commands/nodes.ts#L166) - `node rm`'s help, which says the token is refused from the next connection on"
---

## Goal

A person who runs the daemon finds a page under `docs/server/` for each `ahpd` command group.
Teams and projects, joined nodes and automations get a page each, and the plugins page covers its missing commands.
Each page says what the group is for and what each of its commands does.
The pages land before 0.15.0: they document what is already built.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- `team` and `project` are one line in `USERS.md`.
- `join` and `node` are only in *Joined nodes* of `plugins/COMPUTERS.md`.
- `automation` is only in `sdk/AUTOMATIONS.md`, written for a developer.
- `server/PLUGINS.md` has no `available`, `apply` or `reload`, and no plugin lists.
- `ahpd node rm --help` says a removed node's token is refused from its next connection on. Since #382, a removed node is cut off at once.
- The build throws for a page in no sidebar group, and refuses a dead link.

### Searches performed

- `rg -n "ahpd (team|project|node|join|automation)" docs/server` - the coverage above.
- `ahpd <group> <command> --help` for each command - what each one says it does.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Pages under `docs/server/`, not a guide folder | Softov, 2026-11-20: "maybe we dont need a /guide but on server we need the missing pages." | 01-04 |
| TEAMS.md, NODES.md, AUTOMATIONS.md, and the gaps of PLUGINS.md | Softov, 2026-11-20, all four chosen | 01-04 |
| The pages land before 0.15.0 | Softov, 2026-11-20: "they are before 0.15. Its the documentation of things done." | 01-04 |
| A new page follows `VAULT.md`'s shape | (defaulted: a second instance copies the first one's shape) | 01-03 |
| A page links the sdk and plugin pages for the detail, and copies none of it | (defaulted: a fact is written in one file) | 01-04 |
| A new page goes in the Server sidebar group and the `server` table after `USERS.md` | (defaulted: beside the pages it relates to) | 01-03 |
| `node rm`'s help says the node is cut off at once | (defaulted: the help says what #382 does) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - teams and projects have a page](task-01-teams-and-projects-have-a-page.md) | done | - |
| [02 - joined nodes have a page](task-02-joined-nodes-have-a-page.md) | done | - |
| [03 - automations have a server page](task-03-automations-have-a-server-page.md) | done | - |
| [04 - the plugins page covers every command](task-04-the-plugins-page-covers-every-command.md) | done | - |

## Risks and tradeoffs

- A page states what the code does, so each line is checked against the command's help and its code, not written from memory.
- #390 changes the root README, and none of these pages. The two do not conflict.

## Resume state

- **Done so far:** the four tasks, merged in #391 on 2026-11-20, green on the first run.
- **Next action:** none. Softov read the pages on 2026-11-20; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `pnpm docs:build` needs `pnpm build` first, for the command reference; add a page and its sidebar entry in one commit.

## Final verification checklist

- [x] `pnpm docs:build` passes, and the Server group lists the three new pages.
- [x] Each command of `team`, `project`, `join`, `node`, `automation` and `plugin` is on a server page.
- [x] Each line matches the command's help and its code.
- [x] Softov reads the pages.
