---
title: A chat's certificate status is in the session
status: todo
depends: [task-01-a-chat-terminates-tls.md]
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/meta/vscode/agentSandboxCertificate.ts`, the status; `node/protocolServerHandler.ts#L4354-L4382`, the checks
---

## Objective

Each running chat's certificate status is in its session's `_meta`, and `vscode/refreshSandboxCertificate` reads it again.

## Files

- `UPDATE: packages/computer/src/sandboxca.ts` - a chat's status.
- `UPDATE: packages/sdk/src/types/sandbox.ts` - the certificate operations on the sandbox port.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - `vscode/refreshSandboxCertificate`, and the checks the four methods share.
- `UPDATE: packages/sdk/src/host/sandbox.ts` - `vscode.sandboxCertificate` in the session's `_meta`, beside the chat's sandbox state.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the refresh capability, on a direct connection only.
- `UPDATE: packages/sdk/src/host/gate.ts` - `session:configure` for the four methods.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `UPDATE: packages/computer/test/sandboxca.test.ts` - the status for each state.

## Steps

1. Refuse a chat that is not a URI, a blank `scopeId`, and a chat that no longer runs.
2. Say `notRequired` for a chat with no sandbox or one that does not terminate.
3. Say `unsupported` for a chat that allows the whole network, runs in a machine, or runs where srt cannot terminate.
4. Say `notInstalled` when the OS store does not trust the CA.
5. Say `installed` when the store trusts the CA and `validateCaPair` passes, and `error` with `detail` when the check fails.
6. Set `requiresRotation` when the CA fails the check or ends within 30 days.
7. Set `canInstall` when the platform can trust the CA.
8. Put the statuses under `vscode.sandboxCertificate` `{version: 1, chats}`, and drop the key when no chat has one.
9. Read the asked chat's status on `vscode/refreshSandboxCertificate`, and every running chat's status in a `finally`.

## Validation

- `packages/computer/test/sandboxca.test.ts` - each state, for two chats of one scope.
- The sdk and computer vitest suites pass, one at a time.

## Resume
