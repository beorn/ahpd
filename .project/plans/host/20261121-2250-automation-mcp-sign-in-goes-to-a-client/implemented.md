---
title: An automation's MCP sign-in goes to a client - implemented
date: 2026-11-21
refs:
  - git://acd3de457
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts)"
  - "[code://packages/sdk/src/host/sessionevents.ts](../../../../packages/sdk/src/host/sessionevents.ts)"
  - "[code://packages/sdk/test/automation-mcp-sign-in.test.ts](../../../../packages/sdk/test/automation-mcp-sign-in.test.ts)"
---

An MCP server in a session an automation runs that reports `authRequired` is now put to the automation owner's clients for a token they already hold. The connections are asked in turn, each one through `vscode/requestMcpAuthentication`, and the first answer of `{authenticated: true}` ends the round; a refusal, an error or a client that does not serve the method goes on to the next and is logged at debug. A session a person opened is left to that person's window, a server a connector owns is skipped, and a challenge is asked once per session until its server leaves `authRequired` or the session ends.

## What was built

- [`code://packages/sdk/src/host/sessionevents.ts`](../../../../packages/sdk/src/host/sessionevents.ts) - the `customizations` reader. Every action that moves a session's customization list (`session/customizationsChanged`, `session/customizationUpdated`, `session/mcpServerStateChanged`) is offered to it with the list the session's state holds after the action, which is both halves a client reads.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - the sign-in round. A run's session is read for top-level MCP servers in `authRequired`; each challenge is keyed by resource, required scopes, reason and OAuth client id, and asked once of the automation owner's connections in the order they joined. The request is `{target: {kind: 'mcpServer', session, customizationId}, serverName, auth}`, with `auth` the challenge without its `kind`. A server that leaves `authRequired` has its challenges forgotten, and a session that ends has them dropped.
- [`code://packages/sdk/test/automation-mcp-sign-in.test.ts`](../../../../packages/sdk/test/automation-mcp-sign-in.test.ts) - the tests: the owner's two connections where the first answers false and the second true, another person's connection never asked, one challenge asked once however often it is said, the same challenge asked again after its server was ready, a connector's server skipped while the session's own is asked, and a session no automation runs not asked.

## Verified

- `pnpm typecheck` passes.
- `pnpm boundary` passes, with every package declaring the imports it uses.
- The sdk suite was not run here. The owner runs every suite under the lock, and the plan's final checklist waits on it.

## Departures from the plan

- "A server owned by a connector is skipped (defaulted: VS Code L1654)" has no field to read here: the protocol draws no connector on an MCP customization. The only non-backend owner a customization list holds is a plugin container, so a server nested in a plugin's `children` is taken as the connector's and skipped, and only top-level `type: 'mcpServer'` entries are asked about. The VS Code line at `ddbdd50a9ed1` could not be read in this session, as network access was denied.
- The plan names `session/customizationsChanged` as the action to watch. The reader also takes `session/customizationUpdated` and `session/mcpServerStateChanged`, because a backend here reports an `authRequired` transition through all three and the first alone would miss most of them.
- A challenge is marked as asked before the round goes out, so two actions saying the same thing do not ask twice while a round is still in flight. A run whose owner has no connection at the moment of the challenge is therefore not asked again for the same challenge; only a server that leaves and re-enters `authRequired` asks again. The plan does not decide the case of a client arriving later.

## Left for later

- None of the plan's work is left. The other half, a client that pushes the token it holds through `authenticate` without prompting, is already served by the host and was not part of this plan.
