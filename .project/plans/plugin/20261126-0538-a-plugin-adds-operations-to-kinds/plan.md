---
title: A plugin adds operations to kinds it did not register
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
  - "[code://packages/sdk/src/kinds/operations.ts#L144-L210](../../../../packages/sdk/src/kinds/operations.ts#L144-L210) - `kindOperations` and `kindOffers`, which gain the added operations"
  - "[code://packages/sdk/src/lists/channel.ts#L148-L160](../../../../packages/sdk/src/lists/channel.ts#L148-L160) - the list's operations"
  - "[code://packages/sdk/src/lists/channel.ts#L310-L322](../../../../packages/sdk/src/lists/channel.ts#L310-L322) - `run`, which routes an operation to its kind's `invoke`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L676](../../../../packages/sdk/src/plugins/plugins.ts#L676) - the fold of lists, where the added operations join their kinds"
---

## Goal

A plugin adds an operation to kinds that other plugins registered, such as a deploy onto services.
It may also add one to the list as a whole, such as an export. The operation reaches every record of those kinds, and its `offered` may narrow it to some.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `registerOperation({ channel, kinds?, operation, invoke })` adds an operation onto the kinds it names, or onto the list as a whole when it names none | the brief's *Deploy*, and Softov, 2026-11-26, chose "Yes, onto a list too" | 01 |
| The id is `<kind>/<operation>` under each kind it lands on, such as `systemd/deploy` | Softov, 2026-11-26, chose "<kind>/<operation> per kind"; settles the brief's open point 1 | 02 |
| A list operation's id is `<plugin>/<operation>`, with `list` scope | (defaulted: it has no kind to name) | 02 |
| An id that clashes with a kind's own, or with create, update or remove, is refused at the fold, and the kind's own stays | (defaulted: the fold reports a clash and keeps the first) | 02 |
| The added operation's `invoke` is the adding plugin's, given the row and the input | the brief's *Deploy* | 02 |
| Its grant, words and text come from the adding plugin | (defaulted: the plugin that wrote it says it) | 02 |
| An operation onto a kind that no plugin registered is kept, and lands when the kind loads | (defaulted: plugins load in any order) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-plugin-registers-an-operation](task-01-a-plugin-registers-an-operation.md) | todo | - |
| [02 - the-list-serves-added-operations](task-02-the-list-serves-added-operations.md) | todo | 01 |

## Risks and tradeoffs

- One operation onto N kinds shows as N ids.
- A plugin that adds a write to another plugin's rows has to be trusted with those rows.

## Resume state

- **Done so far:** the plan.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the host keeps no row of a plugin's list.

## Final verification checklist

- [ ] An operation onto two kinds of another plugin is listed and runs.
- [ ] An operation onto a list runs with no row.
- [ ] `pnpm typecheck`, the sdk and server suites, and `pnpm docs:build` pass.
