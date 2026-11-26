---
title: A list's operations are translated
domain: plugin
status: planned
priority: high
created: 2026-11-26
revalidated: 2026-11-26
requires:
  - plans/plugin/20261126-0356-a-plugin-serves-a-list-and-its-kinds/plan.md
refs:
  - git://6f428e565 - main when the plan was made, with the lists of #485
  - "[briefs/a-list-and-its-kinds.md](../../../briefs/a-list-and-its-kinds.md) - the shape these steps build"
  - "[code://packages/sdk/src/kinds/operations.ts#L55-L90](../../../../packages/sdk/src/kinds/operations.ts#L55-L90) - `operationsIn` and `hostOperationText`, which the tunnels already translate with"
  - "[code://packages/sdk/src/tunnels/channel.ts#L362](../../../../packages/sdk/src/tunnels/channel.ts#L362) - the tunnels' `textOf`, the pattern a list copies"
  - "[code://packages/sdk/src/lists/channel.ts#L148-L160](../../../../packages/sdk/src/lists/channel.ts#L148-L160) - the list's operations, sent in English today"
---

## Goal

A client reads a list's operations and kinds in its own language. The words of create, update and remove come from the host's catalogs.
A kind's own words come from the catalogs of the plugin that registered it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A list translates its operations as the tunnels do: the host's words at `operations.list.<name>`, and a kind's own at `operations.<name>` in its plugin's catalogs | (defaulted: mirror the tunnels) | 01 |
| A kind's title and description are read at `kinds.<name>` in its plugin's catalogs | (defaulted: a kind's words are its plugin's) | 01 |
| The remove question names the kind, with the kind's translated title | (defaulted: "Remove this todo?" today) | 01 |
| The snapshot, each `operations` action and the `ahpd.channels` entry use the reader's locale | (defaulted: as the tunnels do) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-list-speaks-the-readers-language](task-01-a-list-speaks-the-readers-language.md) | todo | - |

## Risks and tradeoffs

- A plugin with no catalog shows its words in English to every reader.

## Resume state

- **Done so far:** the plan.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the host keeps no row of a plugin's list.

## Final verification checklist

- [ ] A list reads in the reader's language, as the tunnels do.
- [ ] `pnpm typecheck`, the sdk and server suites, and `pnpm docs:build` pass.
