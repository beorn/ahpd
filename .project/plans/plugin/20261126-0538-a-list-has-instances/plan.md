---
title: A list has instances
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
  - "[code://packages/sdk/src/types/lists.ts#L36-L150](../../../../packages/sdk/src/types/lists.ts#L36-L150) - the declarations that gain `instance` and the instance calls"
  - "[code://packages/sdk/src/plugins/validate.ts#L1154](../../../../packages/sdk/src/plugins/validate.ts#L1154) - `checkList`, which refuses `instances` today"
  - "[code://packages/sdk/src/lists/channel.ts#L51-L110](../../../../packages/sdk/src/lists/channel.ts#L51-L110) - the query, the kind test and the row test, which gain `instance`"
  - "[code://packages/sdk/src/lists/channel.ts#L170-L230](../../../../packages/sdk/src/lists/channel.ts#L170-L230) - `rowsOf`, `find` and `changed`, which ask each instance"
  - "[code://packages/sdk/src/channels/owners.ts#L82-L114](../../../../packages/sdk/src/channels/owners.ts#L82-L114) - `ownerAllows`, the owner rule a connector is read by"
  - "[code://packages/sdk/src/types/connectors.ts#L486](../../../../packages/sdk/src/types/connectors.ts#L486) - `open(connector)`, where a plugin hears a connector come and answers its close"
---

## Goal

A list with `instances: true` holds rows from several sources of one kind, such as one Desk connector each. A kind adds and removes an instance while the host runs, and a row is `<name>://<instance>/<id>`. A reader sees the rows of the instances whose owner lets them in.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `addInstance({ id, title, owner? })` and `removeInstance(id)` on the kind's handle | the brief's *Step 2* | 01 |
| A row's URI is `<name>://<instance>/<id>`, and a row in the channel has `instance` | the brief's *How the instance is correlated* | 02 |
| The host shows an instance's rows by the owner rule connectors are read by: the reader's own, their teams', and the host's to anyone with `<name>:get` | Softov, 2026-11-26, chose "Host applies the owner rule" | 02 |
| An instance with no owner falls back to the list's grant | (defaulted: the brief's "A kind with no instance falls back to the channel's grant") | 02 |
| `x-ahpd/invokeOperation` names a row with `target.id` set to `<instance>/<id>` | Softov, 2026-11-26, chose "target.id is <instance>/<id>" | 02 |
| An id with a slash in an instance list is refused | (defaulted: it would read as an instance) | 02 |
| A query may set `instance`, and it takes several values | the brief's *How the instance is correlated* | 02 |
| A plugin adds a connector as an instance from its adapter's `open`, and removes it in the close that `open` answers | (defaulted: the brief's `host.onConnector` is that hook) | 03 |
| The snapshot lists the instances, and each watched URI gets `<scheme>/instances`, with the rows of an instance that came or went | (defaulted: a client draws the instance filter from it) | 02 |
| A list with no `instances` refuses an `addInstance` | the brief's *Step 1* | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an-instance-comes-and-goes](task-01-an-instance-comes-and-goes.md) | todo | - |
| [02 - the-channel-serves-each-instance](task-02-the-channel-serves-each-instance.md) | todo | 01 |
| [03 - a-connector-is-an-instance](task-03-a-connector-is-an-instance.md) | todo | 02 |

## Risks and tradeoffs

- Each instance is one more `rows.list` call per snapshot.
- A connector whose owner changes keeps its old owner until it opens again.

## Resume state

- **Done so far:** the plan.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** the host keeps no row of a plugin's list.

## Final verification checklist

- [ ] A list with two instances answers both, each row named by its instance.
- [ ] A reader sees only the instances their owner rule lets in.
- [ ] A connector that comes and goes adds and removes an instance.
- [ ] `pnpm typecheck`, the sdk and server suites, and `pnpm docs:build` pass.
