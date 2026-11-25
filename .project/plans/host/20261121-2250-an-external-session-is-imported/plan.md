---
title: An external session is imported
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Session import*"
  - "[code://packages/sdk/src/host/catalogue.ts#L1843-L1854](../../../../packages/sdk/src/host/catalogue.ts#L1843-L1854) - `adoptExternalSession`, which a person's first turn calls today"
  - "[code://packages/sdk/src/host/history.ts#L371](../../../../packages/sdk/src/host/history.ts#L371) - `restoreSession`, which answers a session's cached turns"
  - "[code://packages/sdk/src/host/history.ts#L515](../../../../packages/sdk/src/host/history.ts#L515) - `evictSessionState`, which clears the cache, to reuse for the reload"
  - "[code://packages/sdk/src/host/gate.ts#L52](../../../../packages/sdk/src/host/gate.ts#L52) - `session:create`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L3987-L4001`, the handler; `node/agentService.ts#L2599-L2621`, `importSession`; `common/agent.ts#L207-L220`, `takeOver` and the reload; `AGENTS.md#L370`, the adoption rule
---

## Goal

A client makes an external session this host's own without sending it a message. VS Code's window does this when a person opens one to continue it. An external session is one an agent made outside ahpd, such as a Claude session started in a terminal. The session keeps its URI and its turns.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "importSession|vscode.importSession" packages/` - nothing.
- `rg "adoptExternalSession" packages/sdk/src` - only a person's first turn adopts a session.

### Runtime path

```
vscode/importSession {session, takeOver?} -> restoreSession -> the chat's turns read again when it was loaded
  -> adoptExternalSession -> {session}
```

### Gaps

- Only a turn adopts an external session.
- A session the host had loaded keeps the turns it read, even when another program ran turns since.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan session import | Softov, 2026-11-21, "Read the handler, then plan it (Recommended)" | 01 |
| `vscode/stageCreateSessionImportChunk` is its own plan: `host/20261121-2250-a-session-is-created-from-a-conversation` | (defaulted: VS Code gates it by `vscode.createSessionImport`, a separate capability) | - |
| `_meta` advertises `vscode.importSession` | (defaulted: VS Code `agentHostSessionImportMeta.ts`) | 01 |
| A session the host had loaded reads its default chat's turns again, and the read turns replace the held ones; with a turn running, the replacement waits until it ends | (defaulted: VS Code `_replaceReloadedChatTurns`) | 01 |
| `takeOver` is accepted and ignored: no ahpd agent keeps an in-use record | (defaulted: VS Code's flag, `rg takeOver packages/agent-*` finds nothing) | 01 |
| A session the host does not know is refused with `Session not found` | (defaulted: VS Code L2616) | 01 |
| The chat's draft takes the model the backend restored | (defaulted: VS Code `_offerImportedChatSelection`) | 01 |
| The method needs `session:create` | (defaulted: adoption makes a session this host's own) | 01 |

## Proposed architecture

- **Data flow** - the method restores the session, reads its turns again when it was loaded, and adopts it.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/host/catalogue.ts` and `packages/sdk/src/host/history.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An external session is adopted on request](task-01-adopted-on-request.md) | done | - |

## Risks and tradeoffs

- Replacing held turns drops ids a client may hold. VS Code replaces them too, and the snapshot that follows carries the new ones.

## Resume state

- **Done so far:** task 01: `vscode/importSession` restores the session, reads a loaded session's turns again, offers the restored model to the draft, adopts the session, and refuses an unknown one. Who may import is the rule a person's first turn follows: no ownership check of the caller, an unowned external session claimed by the first person to adopt it, and a later import answered with the owner unchanged. The method is gated by `session:create` and advertised in `_meta`. Typecheck and boundary pass; the sdk suite ran under the lock and its one failing case, two test users sharing a client id, is fixed.
- **Next action:** none. Merged as #442, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** a session already adopted answers its URI again; it is not refused.

## Final verification checklist

- [x] A test: an external session is adopted with no turn, and no longer shows as external.
- [x] A test: a loaded session whose backend has a new turn shows that turn after the import.
- [x] A test: an unknown session is refused.
- [ ] The gates pass: typecheck, boundary, and the sdk suite.
