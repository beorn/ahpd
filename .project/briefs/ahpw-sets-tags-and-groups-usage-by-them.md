---
title: ahpw sets tags and groups usage by them
created: 2026-11-21
refs:
  - git://6df60442e - the ahpd commit the facts were checked at
  - git://eae8a25 - the ahpw commit the facts were checked at, on ahpw's main
  - "[code://packages/sdk/src/host/handshake.ts#L527](../../packages/sdk/src/host/handshake.ts#L527) - the `initialize` answer's root `_meta`, where a host says what it supports"
  - "[code://packages/sdk/src/host/handshake.ts#L587](../../packages/sdk/src/host/handshake.ts#L587) - `ahpd.channels` in the same `_meta`"
  - "[code://packages/sdk/src/host/root.ts#L892](../../packages/sdk/src/host/root.ts#L892) - the root state's `_meta`, which repeats the handshake's keys"
  - "[code://packages/sdk/src/agents/channel.ts#L952](../../packages/sdk/src/agents/channel.ts#L952) - an agent put reads `tags`, and a put without them writes none"
  - "[code://packages/sdk/src/connectors/channel.ts#L906-L908](../../packages/sdk/src/connectors/channel.ts#L906-L908) - a connector put reads `tags` the same way"
  - "[code://packages/sdk/src/types/usage.ts#L230](../../packages/sdk/src/types/usage.ts#L230) - `UsageKey` has `tag`"
---

# ahpw sets tags and groups usage by them

Softov wants to tell apart usage of two agents of one engine, or of two logins, in ahpw.
The host keeps tags on agents and connectors, and copies them onto each usage record, since the plan [`usage/20261121-1733-a-record-carries-its-tags`](../plans/usage/20261121-1733-a-record-carries-its-tags/plan.md).
ahpw has no way to set a tag, and no way to group usage by one.
This change gives ahpw a tags field on agents and connectors, "By tag" in the usage Group menu, and the tags in a record's details.
ahpw shows these only on a host that says it has tags.

## What others do

A host says what it supports in the `_meta` of its `initialize` answer, and a client draws a feature only where the host said so.
ahpd does this for `vscode.removeSessionArtifact`, which ahpw reads into `Offers.removesArtifacts`.
No outside reference was checked for the tags field itself.

## What ahpd has today

- An agent put and a connector put read `tags`. A put that sends no `tags` writes a record with none, so a client that does not send them clears them.
- `usage://groups` and `x-ahpd/usage/groups` take `by=tag`, and `tag=a,b` filters the records.
- The `initialize` answer's root `_meta` names no tags support. A host on 0.15.0 refuses `by=tag`.

## What ahpw has today

- The agent form draws its top fields from `agentTopSchema` (`src/resources/agents/form.ts:45`) through scena's `SchemaForm`. `topOf` (`form.ts:60`) fills them from the record. Neither has tags.
- `putAgent` (`src/bridges/agents.ts:148`) sends name, description and icon, and no tags. The same holds for the connector form's `topSchema` (`src/resources/connectors/form.ts:44`) and `putConnector` (`src/bridges/connectors.ts:183`).
- So a save in ahpw clears the tags of an agent or a connector.
- `USAGE_GROUPS` (`src/resources/usage/state.ts:23`) is `user`, `team` and `project`.
- The record details have a Where group (`src/resources/usage/Records.tsx:156`) with session, chat, turn and pools.
- `Offers` (`src/bridges/offers.ts:37`) holds `removesArtifacts`, read from `vscode.removeSessionArtifact` (`offers.ts:106`).
- ahpw takes its types from the published `@ahpd/sdk` 0.15.0, whose `UsageKey` has no `tag` and whose records have no `tags`.

## Who writes

| Writer | Files it touches | What this change does to it |
|---|---|---|
| ahpw branch `shell/clicks-force-no-layout` | `src/bridges/usage.ts`, `src/resources/usage/Records.tsx`, `src/i18n/*` | Both add lines to the same files; the second to merge rebases. |
| MayCXC branches `host/20261101-0329-...`, `host/20261101-0331-...`, `union-2026-11-01-fc4fe451` | `packages/sdk/src/host/root.ts`, `handshake.ts` | One `_meta` key each side; a small conflict where they merge. |
| Other ahpd sessions on `main` | any | The ahpd part is one key in two files. |

## The change

Agreed with Softov on 2026-11-21:

- ahpd adds `'ahpd.tags': {}` to the root `_meta` of the `initialize` answer and of the root state. ahpd is built first.
- The key is an object so that it can carry the tags channel's template later, without a change of type.
- ahpw sets a flag in `Offers` when the key is an object, as it sets `removesArtifacts`.
- On such a host, the agent form has a Tags field after Description, and the connector form one after Owner.
- scena's `SchemaForm` draws the field as a string list, with no new component.
- The form fills the field from the record and sends the list on every save, so a save keeps the tags.
- The usage Group menu has "By tag" after "By project". Ticks combine as they do today.
- A tag row shows its total and opens no page, as a row summed by two keys does.
- A record's details show its tags under Where, after Pools.
- ahpw adds `tag` and `tags` to its own bridge types beside the sdk's, until an sdk release carries them.
- The words go into ahpw's catalog in English, Portuguese and Spanish.
- The Tags field suggests no tags. A host channel that lists the tags a person can see comes when suggestions or a tag filter need it.

The mockup is in ahpw at `.scratch/mockups/tags.html`, with screenshots at 1280 and 760 in both themes. Softov approved it as drawn on 2026-11-21.
