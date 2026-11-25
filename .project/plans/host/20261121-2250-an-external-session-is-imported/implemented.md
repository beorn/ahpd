---
title: An external session is imported - implemented
date: 2026-11-22
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts)"
  - "[code://packages/sdk/src/host/history.ts](../../../../packages/sdk/src/host/history.ts)"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
---

A client can now make an external session this host's own without sending it a turn: `vscode/importSession {session, takeOver?}` restores the session, reads a loaded session's turns again so a transcript another program wrote since is shown, gives the default chat's draft the model the backend restored, adopts the session, and answers `{session}`. The method is advertised in `_meta` and gated by `session:create`.

## What was built

- [`packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - `vscode/importSession`: the URI and `takeOver` checks, the restore, the reload of a loaded session, the model offered to the draft, the owner recorded on adoption, and the answer. An unknown session is refused with `Session not found`; who may adopt one follows the rule a person's first turn follows, with no ownership check of the caller of its own.
- [`packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - `History.loaded(id)` and `History.reloadSession(id)`. The reload waits on a read already in flight, evicts the cached turns through `evictSessionState`, reads the transcript again with `restoreSession`, and replaces a held default chat's turns with `chat/truncated` then `chat/turnsLoaded`. A chat running a turn is not replaced under it: the request is answered and the replacement lands when the turn ends.
- [`packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `adoptExternalSession` records the backend that listed the session as its provider and keeps the name the host holds it by, so a later listing does not find an adopted session external again.
- [`packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `vscode/importSession` needs `session:create`.
- [`packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `_meta` carries `vscode.importSession: true`.
- [`packages/sdk/test/session-import.test.ts`](../../../../packages/sdk/test/session-import.test.ts) - the adoption, the reload with a turn written since, the wait for a running turn, the unknown session, and the two-user rule: the first person to import an unowned session owns it and a later import neither takes it over nor is refused.
- [`packages/sdk/test/users-gate-tables.test.ts`](../../../../packages/sdk/test/users-gate-tables.test.ts) - the served-method count is 70, over main with the image environments.

## Verified

- `pnpm typecheck` passes.
- `pnpm boundary` passes, no undeclared dependency in any package.
- `packages/sdk/test/session-import.test.ts` passes, 5 cases, and the gate tables pass, run by the reviewer under the lock.

## Departures from the plan

- Who may import a session is exactly who may adopt one by sending its first turn, because that is the rule a person's first turn follows today: [`packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) adopts on a user-origin turn with no ownership check of the sender, recording them as the owner only where the session had none. A member may drive a session that is not theirs (`sessiontools.test.ts` states it: a member may write a session and may not delete one that is not theirs), and an unowned external session is visible and sendable to every signed-in member holding the write grant, so it is adoptable by any of them. On a host with users, then, a session nobody owns may be claimed by any caller holding `session:create`; and a session somebody already owns is answered rather than refused, with its owner unchanged, as a turn on it would be. Import widens nothing: it asks for `session:create`, which the write group covers, in place of the turn's `chat:send`, which the same group covers.
- The unknown-session refusal runs before anything is adopted, so a session nobody knows is `Session not found` on every host.
- With no model on the restored turns, the draft is left as it was rather than cleared.
- `adoptExternalSession` now records the provider and the held name. Without them, a store's `external: false` is nothing it keeps, so a later listing would find the session external again.
- The reload's wait for a running turn is asynchronous: the import is answered as VS Code answers it, and the replacement lands when the chat is quiet.
- `takeOver` is checked to be a boolean and otherwise unused, as the plan decided.

## Left for later

- `vscode/stageCreateSessionImportChunk`, which the plan gives its own plan at `host/20261121-2250-a-session-is-created-from-a-conversation`.
