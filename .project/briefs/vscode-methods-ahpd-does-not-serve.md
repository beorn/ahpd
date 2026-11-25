---
title: The vscode/* methods ahpd does not serve
created: 2026-11-21
refs:
  - git://8b6842e2c - main when the facts were checked, with #418's four cleanup methods counted as served
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, section *Later*, the new `vscode/*` methods
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` methods ahpd serves"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agentHostExtensionProtocol.ts#L48-L153`, the method names; `node/protocolServerHandler.ts#L4228-L4440`, their handlers
---

# The vscode/* methods ahpd does not serve

VS Code main names 62 `vscode/*` methods. ahpd served 26 of them when this brief was written, and serves 29 since #428 and #429. This brief sorts the 36 methods it did not serve into groups. Each group says what the methods do in VS Code, what ahpd has, and whether it should get a plan. Softov picks the groups to plan.

## What others do

VS Code's host is the only reference. Its method names are in `common/agentHostExtensionProtocol.ts` at `ddbdd50a9ed1`. Three more protocol files hold the proxy, certificate and sandbox certificate methods: `common/clientProxyProtocol.ts`, `common/clientCertificatesProtocol.ts` and `common/sandboxCertificateProtocol.ts`.

## What ahpd has today

The 36 methods, by group. "Client to host" is a request a client sends; "host to client" is a request the host sends back.

| Group | Methods | What VS Code does | ahpd today |
| --- | --- | --- | --- |
| Worktree disk usage | `measureWorktreeDiskUsage`, `cancelWorktreeDiskUsage` | Client to host: measures a worktree's disk use under a request id, which a cancel stops. Direct clients only (`protocolServerHandler.ts#L4231`). | None. |
| Session move | `moveSession` | Moves a single-chat session under another session. `vscode.sessionMove` advertises it, and a move while chat moves are off is refused with `disabled` (`#L4316`). | `moveChat` only ([`code://packages/sdk/src/host/sessionmethods.ts#L65`](../../packages/sdk/src/host/sessionmethods.ts#L65)). |
| Chat workspace | `setChatWorkspace` | Gives a peer chat that has not started a turn its own folder, worktree or scratch folder, as `createChat` does with `vscode.chatWorkspace` (`agentHostExtensionProtocol.ts#L133-L137`). | None: a chat works in its session's folder. |
| Automation deletion | `deleteAutomation`, `acknowledgeAutomationDeletion` | Client to host: deletes an automation, and acknowledges a deletion. Refused for a client that brings its own credentials (`#L4298`). | Not read further yet. |
| Session import | `importSession` | Client to host: imports a session, with chunks staged by `stageCreateSessionImportChunk` (`#L4295`). | None. |
| Saved chat recovery | `readSavedChat`, `completeSavedChatContinuation` | Reads a saved Claude or Codex chat and completes its continuation in Copilot (`AGENTS.md`). | None. |
| Diagnostic timing | `reportAgentHostFirstResponse`, `reportChatUserInteraction` | Client to host: timing records exported through OpenTelemetry, each behind its own `_meta` capability, only while diagnostics are on (`#L4279`, `#L4319`). | Logs, traces and metrics of its own; no timing records from a client. |
| Shell authentication | `answerShellAuthentication` | Client to host: `{chat, requestId, answer?}` answers a shell's authentication prompt, `{delivered}` back. Behind the root setting `shellAuthentication`, off by default (`AGENTS.md`). | None. |
| MCP authentication | `requestMcpAuthentication` | Host to client: asks the client to authenticate an MCP server (`#L2251`). | None. |
| GitHub environment | `registerGitHubEnvironment`, `unregisterGitHubEnvironment`, `githubEnvironment/changed` | Registers the host as a GitHub environment of the client's account, so other GitHub clients can reach it. Direct clients only. | None. |
| Artifact integrations | `artifactIntegrations`, `artifactIntegrations/update`, `clientArtifactIntegrations`, `clientArtifactIntegrations/register`, `clientArtifactIntegrations/update` | Integrations a session's artifacts link to, offered by the host and by the client, behind `chat.artifactIntegrations.enabled` (`ARTIFACT_INTEGRATIONS_PROPOSAL.md`). | The setting is mirrored only ([`code://packages/sdk/src/vscoderootconfig.ts`](../../packages/sdk/src/vscoderootconfig.ts)). |
| Agent extensions | `listAgentExtensions`, `setAgentExtensionEnabled` | Lists the extensions an agent loads for a session or chat, with id, source and status, and turns one on or off (`#L4392-L4433`). | Plugins, with no method in VS Code's shape. |
| Dev container environments | `devContainers/connectEnvironment`, `devContainers/removeEnvironment`, `devContainers/sandboxSupport`, `devContainers/userState` | Connects a container from an image rather than a folder, and says whether the sandbox works there and how the user's state was carried in. | Dev containers by folder only. |
| Proxy and certificates | `resolveProxy`, `lookupProxyBasicAuthorization`, `lookupProxyKerberosAuthorization`, `clientProxyChanged`, `loadCertificates` | Host to client: the host uses the client's proxy settings and trust roots. `clientProxyChanged` is the client's notice that its settings moved (`#L4275`). Only WSL and local dev container clients offer them (`node/serviceBootstrapping.md`). | None. |
| Sandbox certificates | `installSandboxCertificate`, `rotateSandboxCertificate`, `removeSandboxCertificate`, `refreshSandboxCertificate` | Client to host: `{chat, scopeId}` installs, rotates, removes or rechecks a sandbox's certificate. Direct clients only (`#L4354-L4382`). | None. |

## Who writes

- `packages/sdk/src/host/vscodemethods.ts`: #418, #428 and #429 added methods there, and all three are merged.
- `packages/sdk/src/host/gate.ts`: every new method needs a grant, and `users-gate-tables.test.ts` counts them.
- No other branch or session writes these files now.

## The change

Softov picked each group on 2026-11-21.

| Group | Pick |
| --- | --- |
| Worktree disk usage | Built in #428. |
| Session move | Built in #429. |
| Shell authentication | [plans/host/20261121-2250-a-shell-asks-the-person-for-a-password](../plans/host/20261121-2250-a-shell-asks-the-person-for-a-password/plan.md). |
| Agent extensions | A brief of its own, beside a brief on plugins: VS Code's are Copilot's programs, not plugins. |
| MCP authentication | [plans/host/20261121-2250-automation-mcp-sign-in-goes-to-a-client](../plans/host/20261121-2250-automation-mcp-sign-in-goes-to-a-client/plan.md). |
| Chat workspace | [plans/host/20261121-2250-a-new-chat-gets-a-workspace-of-its-own](../plans/host/20261121-2250-a-new-chat-gets-a-workspace-of-its-own/plan.md). ahpd already has a folder per chat. |
| Dev container environments | [plans/container/20261121-2250-a-dev-container-starts-from-an-image](../plans/container/20261121-2250-a-dev-container-starts-from-an-image/plan.md), then [plans/container/20261121-2250-a-dev-container-keeps-the-users-state](../plans/container/20261121-2250-a-dev-container-keeps-the-users-state/plan.md). |
| Automation deletion | [plans/host/20261121-2250-an-automation-is-deleted-with-its-runs](../plans/host/20261121-2250-an-automation-is-deleted-with-its-runs/plan.md). |
| Session import | [plans/host/20261121-2250-an-external-session-is-imported](../plans/host/20261121-2250-an-external-session-is-imported/plan.md), and the chunks in [plans/host/20261121-2250-a-session-is-created-from-a-conversation](../plans/host/20261121-2250-a-session-is-created-from-a-conversation/plan.md). |
| Sandbox certificates | [plans/container/20261121-2250-a-chat-sandbox-trusts-a-host-ca](../plans/container/20261121-2250-a-chat-sandbox-trusts-a-host-ca/plan.md), on [plans/container/20261121-2250-the-sandbox-runtime-is-ahpios-fork](../plans/container/20261121-2250-the-sandbox-runtime-is-ahpios-fork/plan.md). |
| Artifact integrations | A brief of its own first. |
| Diagnostic timing | [plans/host/20261121-2250-a-client-reports-turn-timing](../plans/host/20261121-2250-a-client-reports-turn-timing/plan.md). |
| Saved chat recovery | Left out for now. |
| GitHub environment | Left out for now. |
| Proxy and certificates | Left out for now. |

- Each group that gets a plan is one plan, in VS Code's names and shapes.
- A group that needs a feature ahpd lacks gets a plan for that feature first, linked by `requires`.
- A group with a plan or a brief of its own leaves this brief once it is built.
