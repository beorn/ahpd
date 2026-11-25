---
title: A conversation is staged and taken by createSession
status: done
depends: []
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L4095-L4150`, staging and taking
---

## Objective

A client stages a conversation in chunks, and `createSession` with `_meta['vscode.importConversation']` hands its turns to an agent that can write them.

## Files

- `CREATE: packages/sdk/src/host/sessionimport.ts` - staging, the limits, and the value's reader.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - `vscode/stageCreateSessionImportChunk`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `createSession` reads the import.
- `UPDATE: packages/sdk/src/types/agent.ts` - an agent's `importConversation`, which writes the history.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.createSessionImport` while one agent can import.
- `UPDATE: packages/sdk/src/host/gate.ts` - `session:create` for the method.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/session-import-chunks.test.ts` - staging, the limits and `createSession`.

## Steps

1. Refuse a blank transfer id, an empty chunk, and a chunk over the limit.
2. Drop a transfer and refuse the chunk when a connection's staged total would pass its limit.
3. Drop a connection's staged chunks when it closes.
4. Read `{transferId}` or an inline value in `createSession`, and join and parse a staged one.
5. Validate the value, and refuse an import beside a fork.
6. Refuse an agent without `importConversation`.
7. Give each turn a fresh id, and hand turns, model and title to the agent before the session starts.
8. Keep a nonblank title, and make no title for the session.

## Validation

- `packages/sdk/test/session-import-chunks.test.ts` - three chunks, each limit, a closed connection, and an agent that cannot import.
- The sdk vitest suite passes.

## Resume
