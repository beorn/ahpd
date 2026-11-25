---
title: The host trusts the CA, rotates it and removes it
status: todo
depends: [task-02-a-chats-status-is-said.md]
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/copilot/copilotSandboxCertificate.ts`, `installForHost`, `rotateForHost` and `removeForHost`
---

## Objective

`vscode/installSandboxCertificate`, `vscode/rotateSandboxCertificate` and `vscode/removeSandboxCertificate` trust the scope's CA in the host's OS store, replace it, and take the trust away.

## Files

- `UPDATE: packages/computer/src/sandboxca.ts` - the trust commands for each platform.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the three methods.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the three capabilities, on a direct connection only.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `UPDATE: packages/computer/test/sandboxca.test.ts` - the commands run, with a fake for each platform.

## Steps

1. On macOS, trust the CA with `security add-trusted-cert -r trustRoot` in the login keychain, and remove it with `security remove-trusted-cert`.
2. On Windows, trust the CA with `certutil -user -addstore Root`, and remove it with `certutil -user -delstore Root` and its thumbprint.
3. On Linux as root, copy the CA into `/usr/local/share/ca-certificates/` and run `update-ca-certificates`; refuse otherwise.
4. On install, skip a CA the store trusts already, and refuse when `canInstall` is false.
5. On rotate, make a new CA, remove the old trust, and trust the new CA.
6. On remove, take the trust away, and keep the CA and its key.
7. Read every running chat's status again in a `finally`, after a failed change too.

## Validation

- `packages/computer/test/sandboxca.test.ts` - install, rotate and remove on each platform's fake, and a refresh after a failure.
- The sdk and computer vitest suites pass, one at a time.

## Resume
