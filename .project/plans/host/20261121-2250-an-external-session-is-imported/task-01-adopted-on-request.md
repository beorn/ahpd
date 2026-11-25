---
title: An external session is adopted on request
status: done
depends: []
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentService.ts#L2599-L2660`, `importSession` and the turn replacement
---

## Objective

`vscode/importSession {session, takeOver?}` restores an external session, reads its turns again when they may be stale, and adopts it.

## Files

- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the method.
- `UPDATE: packages/sdk/src/host/history.ts` - the reload of a loaded session's turns, through `evictSessionState` and `restoreSession`.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - the adoption on request.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.importSession` in `_meta`.
- `UPDATE: packages/sdk/src/host/gate.ts` - `session:create` for the method.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/session-import.test.ts` - the adoption, the reload and the refusal.

## Steps

1. Refuse a URI that is not a session the host knows.
2. Note whether the host had the session loaded, then restore it.
3. Read the default chat's turns again if the host had it loaded, and replace the held turns.
4. Wait for a running turn to end before the replacement.
5. Set the draft's model to the one the backend restored.
6. Adopt the session, and answer `{session}`.

## Validation

- `packages/sdk/test/session-import.test.ts` - an adoption, a reload with a new turn, and an unknown session.
- The sdk vitest suite passes.

## Resume

Implemented. `vscode/importSession` in `packages/sdk/src/host/vscodemethods.ts` parses `session`, checks the URI, restores the session, reads a loaded session's turns again, offers the restored model to the default chat's draft, records the owner, adopts the session, and answers `{session}`. `History` gained `loaded(id)` and `reloadSession(id)` in `packages/sdk/src/host/history.ts`; the reload evicts the cached turns, reads them again, and replaces a held chat's turns with `chat/truncated` then `chat/turnsLoaded`, waiting out a running turn without holding the request. `adoptExternalSession` in `packages/sdk/src/host/catalogue.ts` now also records the backend as the session's provider and keeps the name it is held by, so a later listing does not find the adopted session external again. The gate maps the method to `session:create`, `_meta` advertises `vscode.importSession`, and the served-method count is 65.

Four choices the task did not settle, each written into the code:

- **Who may import follows exactly the rule a person's first turn follows, with no ownership check of its own.** `lifecycle.ts` adopts on a user-origin turn without asking whether the sender owns the session, recording them as owner only where it had none; a member may drive a session that is not theirs, and an unowned external session is visible and sendable to every signed-in member holding the write grant. So an unowned session is claimed by the first person to import it, and a session somebody already owns is answered with its owner unchanged rather than refused, as a turn on it would be. An unknown session is still `Session not found` on every host.
- **The model comes from the last restored turn that names one**, on its message where the backend wrote one and otherwise on its usage. A session whose last turn is a question has no model of its own, and with no model found the draft is left as it was.
- **The reload reads past a read already in flight.** A read that started before the reload carries the turns being replaced, so it is waited on and the read after it is the one asked again.
- **`takeOver` is accepted, checked to be a boolean, and otherwise unused**, as the plan decided.

Validation: `packages/sdk/test/session-import.test.ts` covers an adoption with no turn, a loaded session whose backend wrote a turn since, a replacement that waits for a running turn, an unknown session, and two users on a host with users, where the first to import an unowned session owns it and the later one neither takes it over nor is refused. Typecheck and boundary pass; the sdk vitest suite is for the owner to run under the lock.
