---
title: An automation is deleted with its runs
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Automation deletion*"
  - "[code://packages/sdk/src/automations/automations.ts#L800-L808](../../../../packages/sdk/src/automations/automations.ts#L800-L808) - the store's `remove`, which keeps the run sessions"
  - "[code://packages/sdk/src/host/automations.ts#L384-L393](../../../../packages/sdk/src/host/automations.ts#L384-L393) - what a removal tells the clients"
  - "[code://packages/sdk/src/host/automations.ts#L968](../../../../packages/sdk/src/host/automations.ts#L968) - `kept.setAutomationOrigin`, which keeps each run session's automation across a restart"
  - "[code://packages/server/src/scheduled.ts#L340](../../../../packages/server/src/scheduled.ts#L340) - run history does not survive a restart"
  - "[code://packages/sdk/src/host/handshake.ts#L549](../../../../packages/sdk/src/host/handshake.ts#L549) - `vscode.autonomousAutomations`, beside which the new flags go"
  - "[code://packages/sdk/src/host/lifecycle.ts#L103](../../../../packages/sdk/src/host/lifecycle.ts#L103) - `removeSession`, which deletes a run's session"
  - "[code://packages/sdk/src/host/gate.ts#L230](../../../../packages/sdk/src/host/gate.ts#L230) - `automation:remove`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L4003-L4041`, the two handlers; `node/agentHostAutomationService.ts#L477-L560`, the deletion, its receipts and its refusals; `common/agentHostExtensionProtocol.ts#L310-L316`, the params
---

## Goal

A client deletes an automation and, when it asks, the sessions of its runs. A retry of the same request gets the same answer back until the client acknowledges it. The plain remove action keeps today's behaviour and leaves the run sessions in place. VS Code's plain remove deletes them, so here ahpd differs on Softov's word.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "deleteAutomation|acknowledgeAutomationDeletion|deleteHistory" packages/` - nothing.

### Runtime path

```
vscode/deleteAutomation {automation, deleteHistory, legacySessions?, requestId?} -> the store's remove
  -> with deleteHistory: removeSession for each run session, in the background -> the deleted session URIs
vscode/acknowledgeAutomationDeletion {requestId} -> the receipt is dropped
```

### Gaps

- A client cannot delete an automation's run sessions with it.
- A removal has no receipt, so a retry after a lost answer cannot learn what was deleted.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan automation deletion | Softov, 2026-11-21, "Read the handler, then plan it (Recommended)" | 01, 02 |
| Run sessions are deleted only when the client asks with `deleteHistory: true`; the plain `automation/removed` action keeps them | Softov, 2026-11-21, "Only when the client asks (Recommended)" | 01 |
| `automation` must be an `ahp-automation:` URI with a path and no authority, query or fragment | (defaulted: VS Code L4012-L4014) | 01 |
| `legacySessions` without `deleteHistory` is refused; each entry must be a session URI, not a chat | (defaulted: VS Code L4015-L4024) | 01 |
| An unknown automation with no receipt answers `[]` | (defaulted: VS Code L496-L499) | 01 |
| The run sessions are the sessions whose kept automation origin names the automation, since run history does not survive a restart | `code://packages/server/src/scheduled.ts#L340` | 01 |
| `_meta` advertises `vscode.automationHistory`, `vscode.automationHistoryReceipts` and `vscode.automationHistoryDeletionState` | (defaulted: VS Code `agentHostExtensionProtocol.ts#L220-L226`) | 01 |
| An automation with an active run is refused as `Automation has an active or recovering run and cannot be removed` | (defaulted: VS Code `_prepareAutomationDeletion`) | 01 |
| A chat automation, which continues one conversation, deletes no session | (defaulted: VS Code, `getAgentHostScheduledChat(...).conversation`) | 01 |
| The answer is the session URIs deleted; a repeat with a known `requestId` answers the kept list | (defaulted: VS Code's receipts) | 02 |
| A deletion still running absorbs a second request for the same automation; one without `deleteHistory` is then refused | (defaulted: VS Code L524-L529) | 02 |
| Receipts and deletions in progress are kept beside the definitions in the server's automation file, so a restart finishes them | (defaulted: VS Code persists both) | 02 |
| Both methods need `automation:remove` | (defaulted: the remove action's grant) | 01 |

## Proposed architecture

- **Data flow** - the method checks, removes the definition through the store, then deletes the run sessions one by one.
- **State flow** - deletions in progress by automation, and receipts by request id, both in the store's file.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/automations/automations.ts`, and `packages/server/src/scheduled.ts`, which writes the file.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An automation is deleted, with its runs on request](task-01-deleted-with-its-runs.md) | done | - |
| [02 - A deletion keeps a receipt until acknowledged](task-02-a-deletion-keeps-a-receipt.md) | done | 01 |

## Risks and tradeoffs

- A deleted session cannot come back. Only an explicit `deleteHistory: true` deletes one, and an active run blocks the removal.

## Resume state

- **Done so far:** tasks 01 and 02. `vscode/deleteAutomation` checks the URI, refuses `legacySessions` without `deleteHistory`, an automation with a going run, and an automation its store will not remove; it collects the sessions whose kept automation origin names it plus `legacySessions` (none for a chat automation), removes the definition, deletes the sessions when asked, and answers their URIs. A deletion keeps its sessions and request ids in the store, answers a repeat by `requestId` from its receipt until `vscode/acknowledgeAutomationDeletion`, absorbs a second request, refuses one without `deleteHistory`, and finishes a deletion the server's file held across a restart. The three `vscode.automationHistory*` flags are advertised, both methods need `automation:remove`, and the served count is 62.
- **Next action:** none. Merged as #432, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** ahpw sends the plain remove action; it must keep the run sessions.

## Final verification checklist

- [x] A test: `deleteHistory: true` deletes the run sessions and answers their URIs.
- [x] A test: the plain remove action and `deleteHistory: false` keep them.
- [x] A test: a repeat with the same `requestId` answers the same list, and an acknowledgement drops it.
- [x] A test: an active run, a bad URI and `legacySessions` without `deleteHistory` are refused.
- [x] The gates pass: typecheck, boundary, and the sdk suite.
