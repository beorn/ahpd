---
title: A plugin serves a list and its kinds - implemented
date: 2026-11-26
refs:
  - git://9c453a089 - main the build started from
  - "[code://packages/sdk/src/types/lists.ts](../../../../packages/sdk/src/types/lists.ts) - the declarations"
  - "[code://packages/sdk/src/lists/channel.ts](../../../../packages/sdk/src/lists/channel.ts) - the list channel and the row scheme"
---

A plugin declares a list with `registerList`, and any plugin adds a kind to it with `registerKind`.
The host serves each list as a channel, such as `x-ahpd-todos://`, and each row at `<name>://<id>`.
The host keeps the list's structure and no row: each snapshot and each read asks the kinds.
`x-ahpd/invokeOperation` runs a kind's create, update, remove and own operations through its `invoke`.
`ahpd.channels` lists each list with its kinds and every operation in full.

## What was built

- [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) - `kindOperations` and `kindOffers`, which the tunnels channel now uses too.
- [`code://packages/sdk/src/types/lists.ts`](../../../../packages/sdk/src/types/lists.ts) - `ListDeclaration`, `ListKind`, `ListRows`, `ListKindHandle` and the served forms.
- [`code://packages/sdk/src/plugins/validate.ts`](../../../../packages/sdk/src/plugins/validate.ts) - `checkList`, `checkListKind`, and `checkKindOperations`, which `checkTunnelKind` shares.
- [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts) - the two registrations, and the fold of lists, kinds, grants, channels and row schemes.
- [`code://packages/sdk/src/lists/channel.ts`](../../../../packages/sdk/src/lists/channel.ts) - `listChannel` and `servedList`.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `kinds` on an `ahpd.channels` entry.

## Verified

- New tests: `kind-operations` (3), `plugin-lists` (19), `list-channel` (8) and `lists` (3).
- The sdk suite runs 5399 cases, the server suite 2006 and the devtunnel suite 101, with no failure.
- `pnpm typecheck`, `pnpm build` and `pnpm docs:build` pass.
- [A list of your own](../../../../docs/plugins/PLUGINS.md#a-list-of-your-own) documents the two registrations, at Softov's ask on 2026-11-26.

## Departures from the plan

- A live fold refuses a moved resource scheme, so a new row provider at each fold would refuse every plugin change. `servedList` keeps one served list per base and name, and a fold hands it the list again.
- The same cache keeps the ids each watched URI was sent, so a subscriber keeps its view across a fold.
- Task 04, step 10: `x-ahpd/invokeOperation` already checks the input against the schema, so `run` does not check it again.
- A kind that throws raises a warning on its plugin's row with the plugin host's `problem`.
- A `changed` reads the row with no reader. With no instances, the channel's grant decides who reads, as the brief says.
- A kind that lacks the field of `defaultSort` keeps its rows, which go last.
- Between a list and a `registerChannel` on one scheme, the one whose plugin loaded second is refused.

## Left for later

- The operations of a list are sent in English: a list has no catalogs yet.
- The brief's later steps add instances, paging, the other filters, relations and runtime kinds.
