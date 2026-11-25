---
title: A run's MCP sign-in is asked of the clients
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/trust.ts#L200](../../../../packages/sdk/src/host/trust.ts#L200) - the request goes through `peer.request`, as this one does"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostAutomationService.ts#L1652-L1686`, the challenge and its key
---

## Objective

When a server of an automation's session needs a sign-in, the host sends `vscode/requestMcpAuthentication` to its clients until one signs in.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts` - watch the runs' sessions, and ask on a new challenge.
- `CREATE: packages/sdk/test/automation-mcp-sign-in.test.ts` - the round, the key and the skips.

## Steps

1. Read each `authRequired` MCP server in a run's `session/customizationsChanged`.
2. Skip a server that a connector owns.
3. Skip a challenge whose key the session already asked.
4. Send the request to each of the automation owner's connections, in order, and stop at the first `{authenticated: true}`.
5. Log a refusal or an error at debug level, and go on to the next connection.
6. Forget a server's challenges once it leaves `authRequired`.
7. Drop the session's asked challenges when the session ends.

## Validation

- `packages/sdk/test/automation-mcp-sign-in.test.ts` - two clients, the first answering false.
- The same file - a repeated challenge, and a connector's server.
- The same file - another user's connection, which is not asked.
- The same file - a challenge asked again after the server was ready.
- The sdk vitest suite passes.

## Resume
