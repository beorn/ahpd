---
title: A client plugin's decisions survive the client's next announcement
domain: host
status: built
priority: high
created: 2026-11-23
revalidated: 2026-11-23
refs:
  - git://fcef83870 - main when the plan was made
  - "[code://packages/sdk/src/host/tooling.ts#L1263-L1317](../../../../packages/sdk/src/host/tooling.ts#L1263-L1317) - `reconcile`, which matches a held plugin to an announced one and says what moved"
  - "[code://packages/sdk/src/host/tooling.ts#L782-L783](../../../../packages/sdk/src/host/tooling.ts#L782-L783) - `samePlugin`, which matches by URI and `nonce`"
  - "[code://packages/sdk/src/host/tooling.ts#L1247-L1249](../../../../packages/sdk/src/host/tooling.ts#L1247-L1249) - `signatureOf`, which compares the URI and the `nonce` only"
  - "[code://packages/sdk/src/host/tooling.ts#L194-L216](../../../../packages/sdk/src/host/tooling.ts#L194-L216) - `HeldPlugin`, whose `announced` and `decision` this plan keeps current"
  - "[code://packages/sdk/src/host/tooling.ts#L951-L952](../../../../packages/sdk/src/host/tooling.ts#L951-L952) - `decisionsOf`, which reads `announced.enablement` and `decision`"
  - "[code://packages/sdk/src/host/tooling.ts#L1050-L1066](../../../../packages/sdk/src/host/tooling.ts#L1050-L1066) - `entryOf`, the plugin as `session/customizationUpdated` carries it"
  - "[code://packages/sdk/src/host/tooling.ts#L1444-L1445](../../../../packages/sdk/src/host/tooling.ts#L1444-L1445) - `pluginsMoved`, which starts a chat again with the new set of plugin copies"
  - "[code://packages/sdk/test/client-plugins-session.test.ts#L345](../../../../packages/sdk/test/client-plugins-session.test.ts#L345) - the case that an unchanged announcement says nothing, which stays true"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L565 - the reference host takes a client's customizations whole on each `session/activeClientSet`
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2120-L2124 - the reference host keeps a session's decision in a service keyed by the customization, not by the announced copy
---

## Goal

A client announces its plugins again with `session/activeClientSet` whenever its view of them changes.
Today the host loses two kinds of change in that announcement.
A new global decision on a plugin with the same `nonce` is ignored, so the host and the agent keep the old state.
A new `nonce` drops the decision that a person made for this session.
After this plan, the session's list and the agent's plugins follow each announcement.
A session's own decision stays until a person changes it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "customizationsChanged" packages/sdk/src` - `dispatch` lays the client half on every `session/customizationsChanged` (`host.ts:1101-1115`), so `reconcile` does not drop the plugins of another client.
- `rg "activeClientsOf" packages/sdk/src` - `reconcile` reads every client from `presence`, the map that the snapshot reads.
- A scratch test in the harness of `client-plugins-session.test.ts` at `git://fcef83870` gave three results.
  A second client that joins keeps the plugin of the first: not reproduced.
  A new global decision with the same `nonce`: the host keeps `enabled: false`.
  A new `nonce` after a session toggle: the session entry is gone.

### Runtime path

```
client: session/activeClientSet {customizations} -> actions.ts held presence -> retool -> reconcilePlugins
  -> reconcile: match held plugins (samePlugin) -> signatureOf compare -> plugins map
  -> session/customizationsChanged + session/customizationUpdated -> every client
  -> heldCopies (enabledOf) -> pluginsMoved -> the chat starts again with the new copies
```

### Gaps

- A kept `HeldPlugin` holds the `announced` of the first announcement, so a later `enablement` or `childEnablement` is not read.
- `signatureOf` does not see a change of decision, so `reconcile` returns before it says anything.
- A plugin announced with a new `nonce` is a new `HeldPlugin` without the old `decision`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan the fix in ahpd for the plugin decisions that ahpw showed wrong | Softov, 2026-11-23, "ok, do the plan for the fix on ahpd." | 01, 02 |
| A kept plugin takes the new `announced` whole on each announcement | (defaulted: the reference host sets `handle.customizations` whole, `agentSideEffects.ts#L565`) | 01 |
| A change of `enablement` or `childEnablement` counts as a move in `signatureOf` | (defaulted: a decision is part of what a client announces) | 01 |
| A kept plugin whose decisions moved is said with `session/customizationUpdated`, and is not copied again | (defaulted: the `nonce` says when the content moved, so the copy stays) | 01 |
| An announcement with the same `nonce` and the same decisions says nothing | [`code://packages/sdk/test/client-plugins-session.test.ts#L345`](../../../../packages/sdk/test/client-plugins-session.test.ts#L345) | 01 |
| The agent gets the new set through `pluginsMoved` at the chat's next send | (defaulted: the path a session toggle already takes) | 01 |
| A new `nonce` for the same URI from the same client keeps the old `decision` | (defaulted: the reference host keys a session decision by the customization, `agentSideEffects.ts#L2120-L2124`) | 02 |

## Proposed architecture

- **Data flow** - `reconcile` matches a held plugin by URI and client, takes the new `announced`, and copies again only when the `nonce` moved.
- **Event flow** - a moved decision is one `session/customizationUpdated` for that plugin; a moved `nonce` stays a `loading` entry and a copy, as today.
- **State flow** - `HeldPlugin.decision` belongs to the plugin's URI under its client, so a new revision carries it.
- **Layer responsibilities** - sdk only, in `packages/sdk/src/host/tooling.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A same nonce takes the new decisions](task-01-a-same-nonce-takes-the-new-decisions.md) | done | - |
| [02 - A new nonce keeps the session's decision](task-02-a-new-nonce-keeps-the-sessions-decision.md) | done | 01 |

## Risks and tradeoffs

- A client can announce the same plugins and decisions often.
  The comparison stays silent for it, as the case at line 345 checks.
- A decision that turns a plugin off reaches the agent only at the chat's next send, as a session toggle does today.

## Resume state

- **Done so far:** tasks 01 and 02, as [implemented.md](implemented.md) says.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `samePlugin` serves two purposes today: it keeps a copy and it says nothing moved. Task 01 separates the two, and the copy still follows the `nonce` only.

## Final verification checklist

- [x] A test: a new global decision with the same `nonce` is in the session's list and in a snapshot.
- [x] A test: a new `nonce` keeps the session entry of a plugin that was turned off for the session.
- [x] The case at line 345 passes: an unchanged announcement says nothing.
- [x] `packages/sdk/test/client-plugins-session.test.ts` passes.
