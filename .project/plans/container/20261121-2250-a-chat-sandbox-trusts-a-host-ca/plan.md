---
title: A chat's sandbox trusts a host CA
domain: container
status: planned
priority: medium
created: 2026-11-21
revalidated: 2026-11-22
requires:
  - plans/container/20261121-2250-the-sandbox-runtime-is-ahpios-fork/plan.md
refs:
  - git://32915e099 - main when the plan was revised
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Sandbox certificates*"
  - "[code://packages/computer/src/sandbox.ts#L210-L222](../../../../packages/computer/src/sandbox.ts#L210-L222) - the settings a chat's sandbox runs with, and `advanced.runtime` merged in"
  - "[code://packages/sdk/src/sandbox.ts#L286](../../../../packages/sdk/src/sandbox.ts#L286) - `withChatSandboxState`, the shape a chat's sandbox `_meta` takes"
  - "[code://packages/sdk/src/host/sandbox.ts#L148](../../../../packages/sdk/src/host/sandbox.ts#L148) - where a chat's sandbox `_meta` is written"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` handlers"
  - "[code://packages/sdk/src/host/handshake.ts#L527-L535](../../../../packages/sdk/src/host/handshake.ts#L527-L535) - the `vscode.*` capabilities in `_meta`"
  - "[code://packages/sdk/src/host/gate.ts#L55-L68](../../../../packages/sdk/src/host/gate.ts#L55-L68) - the grant of each `vscode/*` method"
  - https://github.com/anthropics/sandbox-runtime/blob/v0.0.83/README.md#tls-termination - `network.tlsTerminate`, its CA, and its limits
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L4354-L4382`, the four methods; `node/copilot/copilotSandboxCertificate.ts`, install, rotate and remove of OS trust; `common/meta/vscode/agentSandboxCertificate.ts`, the capabilities and the status; `node/copilot/copilotAgent.ts#L5827-L5853`, a refresh after each change
---

## Goal

A chat whose sandbox terminates TLS signs with a CA the host keeps. VS Code's four sandbox certificate methods let a client manage that CA. The client trusts it in the host's OS store, rotates it, removes the trust, and reads the status again. The methods mean what they mean in VS Code.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "SandboxCertificate|tlsTerminate|caCertPath" packages/` - nothing.
- 0.0.83's `index.ts` - exports `generateCa`, `validateCaPair` and `certThumbprint`. `windowsTrustCa` trusts the sandbox account's store, not the user's.
- 0.0.83's `network.tlsTerminate` - without `caCertPath`, srt makes an ephemeral CA per session on macOS and Linux. It passes the CA into the sandbox through `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `GIT_SSL_CAINFO` and others.
- VS Code's `copilotSandboxCertificate.ts` - a chat needs the CA only when its credential settings need termination, else `notRequired`. Install trusts the existing CA in the OS store after consent. Remove takes the trust away and keeps the CA and key.

### Runtime path

```
a chat's settings ask for termination -> tlsTerminate gets the scope's host CA -> srt signs with it
vscode/installSandboxCertificate {chat, scopeId} -> the CA trusted in the OS store
vscode/rotateSandboxCertificate -> a new CA, the old trust removed, the new one trusted
vscode/removeSandboxCertificate -> the trust removed, the CA and key kept
vscode/refreshSandboxCertificate -> the status read again -> session _meta['vscode.sandboxCertificate']
```

### Gaps

- A chat that terminates gets an ephemeral CA, which no OS store can follow.
- No `vscode/*SandboxCertificate` method is served, and a session says nothing about a chat's certificate.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan sandbox certificates, on the fork | Softov, 2026-11-21, "Plan the runtime switch and the CA (Recommended)" | 01, 02, 03 |
| The four methods mean VS Code's: install, rotate and remove manage the host OS trust of the CA; the chat's settings decide termination | Softov, 2026-11-22, "VS Code's: OS trust (Recommended)" | 02, 03 |
| A chat needs the CA when its settings ask for termination: `network.tlsTerminate` or `credentials` in `advanced.runtime` | (defaulted: VS Code `checkRelevance` over the credential settings) | 01 |
| The host keeps one CA per scope, made with `generateCa`, owner-only in the configuration folder; a chat that terminates gets its paths in `tlsTerminate`, over paths in `advanced.runtime` | (defaulted: srt's own CA is ephemeral on macOS and Linux) | 01 |
| The CA's key is in every sandbox's `denyRead` | (defaulted: the key mints a certificate any sandboxed program trusts) | 01 |
| `scopeId` is the host's runtime scope; a chat whose sandbox runs in a machine says `unsupported` | (defaulted: that sandbox runs the machine's `srt`, and its OS store is the machine's) | 01, 02 |
| A chat that allows the whole network says `unsupported`: with `network.enabled: false` no proxy starts | (defaulted: VS Code's five states) | 02 |
| `installed` is the CA trusted in the store with `validateCaPair` passing; `requiresRotation` when it fails the check or ends within 30 days | (defaulted: VS Code's status doc) | 02 |
| macOS trusts in the login keychain with `security add-trusted-cert -r trustRoot`, and removes with `security remove-trusted-cert` | Softov, 2026-11-22, the same answer; (defaulted: the commands) | 03 |
| Windows trusts in the user's Root store with `certutil -user -addstore Root`, and removes with `certutil -user -delstore Root` and the thumbprint | Softov, 2026-11-22, the same answer; (defaulted: the commands) | 03 |
| Linux trusts only as root, in `/usr/local/share/ca-certificates/` with `update-ca-certificates`; otherwise `canInstall` is false | Softov, 2026-11-22, the same answer | 03 |
| Rotate makes a new CA, removes the old trust and trusts the new CA; remove keeps the CA and key | (defaulted: VS Code `rotateForHost`, `removeForHost`) | 03 |
| Params are `{chat, scopeId}`; a chat that is not a URI, and a blank `scopeId`, are refused | (defaulted: VS Code L4363-L4379) | 02 |
| A chat that no longer runs is refused as `The chat is no longer running. Reopen it before changing sandbox certificate trust.` | (defaulted: VS Code `_withSandboxCertificateRefresh`) | 02 |
| Every running chat's status is read again in a `finally`, after a failed change too | (defaulted: VS Code L5847-L5852) | 02, 03 |
| `_meta` advertises the four capabilities only to a direct connection, not through a relay | (defaulted: VS Code L4365) | 02, 03 |
| The four methods need `session:configure` | (defaulted: a chat's sandbox settings are its session's configuration) | 02, 03 |

## Proposed architecture

- **Data flow** - the sdk's methods reach the computer plugin through the sandbox port. The plugin keeps the CA, writes `tlsTerminate` into the settings of a chat that terminates, and runs the OS trust commands.
- **State flow** - the CA by scope in the configuration folder; each chat's status in its session's `_meta`.
- **Layer responsibilities** - sdk: the methods, the grant, the capabilities and the status in `_meta`; computer: the CA, the settings and the OS store.
- **Source-of-truth files** - `packages/computer/src/sandboxca.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A chat that terminates signs with the host CA](task-01-a-chat-terminates-tls.md) | todo | - |
| [02 - A chat's certificate status is in the session](task-02-a-chats-status-is-said.md) | todo | 01 |
| [03 - The host trusts the CA, rotates it and removes it](task-03-the-host-trusts-the-ca.md) | todo | 02 |

## Risks and tradeoffs

- A trusted CA lets its key sign for any site on the host, outside the sandbox too. It stays owner-only, outside every sandbox's read list, and is trusted only on a client's install.
- On macOS and Windows the OS can ask the person to allow the change. A daemon with no desktop session gets an error, which the status says.

## Resume state

- **Done so far:** nothing.
- **Next action:** none until a feature turns termination on: no ahpd setting does today, so every chat would say `notRequired`. [briefs/a-machine-never-holds-the-git-token.md](../../../briefs/a-machine-never-holds-the-git-token.md) is the likely one. Then [task-01-a-chat-terminates-tls.md](task-01-a-chat-terminates-tls.md). Parked on Softov's word, 2026-11-22.
- **Open questions:** none.
- **Watch out for:** srt's termination needs Node; it throws on Bun older than 1.4.

## Final verification checklist

- [ ] A test: a chat whose settings ask for termination gets the scope's CA in `tlsTerminate`, and the key is in its `denyRead`.
- [ ] A test: the status in `_meta` for each state, for two chats of one scope.
- [ ] A test: install, rotate and remove run the platform's trust commands, with a fake for each, and refresh after a failure.
- [ ] A test: the capabilities reach a direct connection and not a relayed one.
- [ ] The gates pass: typecheck, boundary, and the sdk and computer suites, one at a time.
