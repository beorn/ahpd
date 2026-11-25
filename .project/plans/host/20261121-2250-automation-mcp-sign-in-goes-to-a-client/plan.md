---
title: An automation's MCP sign-in goes to a client
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *MCP authentication*"
  - "[code://packages/sdk/src/host/automations.ts#L959](../../../../packages/sdk/src/host/automations.ts#L959) - a run's session, started by an automation"
  - "[code://packages/sdk/src/host/tooling.ts#L1168](../../../../packages/sdk/src/host/tooling.ts#L1168) - `session/customizationsChanged`, which carries an MCP server's `authRequired` state"
  - "[code://packages/agent-claude/src/session/servers.ts#L227](../../../../packages/agent-claude/src/session/servers.ts#L227) - where Claude reports a server that needs a sign-in"
  - "[code://packages/sdk/src/host/auth.ts](../../../../packages/sdk/src/host/auth.ts) - `authenticate` for an MCP server, which the client calls once it has a token"
  - "[code://packages/sdk/src/host/trust.ts#L200](../../../../packages/sdk/src/host/trust.ts#L200) - `vscode/requestWorkspaceTrust`, the sibling request from the host to a client"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostAutomationService.ts#L1652-L1686`, when it asks; `node/protocolServerHandler.ts#L2240-L2262`, who it asks; `common/agentHostExtensionProtocol.ts#L493-L498`, the request
---

## Goal

An automation's run has nobody watching it. When one of its MCP servers needs a sign-in, the host asks the automation owner's clients for a token they already hold. A client must not prompt: it pushes the token through `authenticate`, as in VS Code, and the run can use the server.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "requestMcpAuthentication" packages/` - nothing.
- `rg "authRequired" packages/sdk/src packages/agent-claude/src` - Claude reports the state, and the host relays it in `session/customizationsChanged`.

### Runtime path

```
a run's session -> session/customizationsChanged with an MCP server authRequired
  -> vscode/requestMcpAuthentication {target, serverName, auth} to each of the owner's connections in turn
  -> the client pushes a token it holds through authenticate, without a prompt -> {authenticated: true} stops the round
```

### Gaps

- The host never asks a client to sign in. An automation's MCP server that needs a sign-in stays unusable until a person opens the session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan MCP authentication | Softov, 2026-11-21, "Plan it (Recommended)" | 01 |
| Only a session an automation runs is asked about; a session a person opens is the window's to prompt | (defaulted: VS Code asks from `agentHostAutomationService.ts` only) | 01 |
| A server owned by a connector is skipped | (defaulted: VS Code L1654) | 01 |
| Each challenge, by server and by `[resource, requiredScopes, reason, clientId]`, is asked once per session | (defaulted: VS Code L1664-L1670) | 01 |
| Each of the automation owner's connections is asked in turn, and the first `{authenticated: true}` ends the round; an error or a refusal goes to the next | (defaulted: VS Code asks every client; on a host with users, only the owner's may see the session or give it a token) | 01 |
| A client must not prompt; it pushes a token it already holds | (defaulted: VS Code `agentHostExtensionProtocol.ts#L487-L491`) | 01 |
| A server's asked challenges are forgotten once it leaves `authRequired`, so a later challenge is asked again | (defaulted: VS Code L1645-L1651) | 01 |
| The request is `{target: {kind: 'mcpServer', session, customizationId}, serverName, auth}` | (defaulted: VS Code `IAgentHostMcpAuthenticationRequest`) | 01 |

## Proposed architecture

- **Event flow** - the host watches `session/customizationsChanged` of the sessions its automations run, and asks on a new challenge.
- **State flow** - the challenges asked, by session and server, dropped with the session.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/host/automations.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A run's MCP sign-in is asked of the clients](task-01-a-runs-sign-in-is-asked.md) | done | - |

## Risks and tradeoffs

- A client that is not VS Code answers the method with an error. The host logs it at debug level and asks the next one.

## Resume state

- **Done so far:** [task-01](task-01-a-runs-sign-in-is-asked.md) - a run's session is watched for `authRequired` servers, and the automation owner's connections are asked in turn. See [implemented.md](implemented.md).
- **Next action:** none. Merged as #435, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** a chat automation's run reuses a session a person may have open. The host asks about it all the same, as VS Code's does. A server a connector owns is read as one of a plugin's children, which is the only owner this protocol draws; it is skipped.

## Final verification checklist

- [ ] A test: a run whose server turns `authRequired` asks the first client, then the second when the first answers false.
- [ ] A test: the same challenge is not asked twice, and a connector's server is not asked.
- [ ] The gates pass: typecheck, boundary, and the sdk suite.
