---
title: An Mcp rule names a server or a tool
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/access/permissionrules.ts#L55-L87](../../../../packages/sdk/src/access/permissionrules.ts#L55-L87) - the request and the matcher"
  - "[code://packages/sdk/src/host/spawn.ts#L626-L632](../../../../packages/sdk/src/host/spawn.ts#L626-L632) - where the request is made"
---

## Objective

A rule `Mcp` matches every MCP call, `Mcp(<server>)` every call of that server, and `Mcp(<server>/<tool>)` that tool, as VS Code main matches them.

## Files

- `UPDATE: packages/sdk/src/access/permissionrules.ts:55-87` - `mcpServerName` and `mcpToolName` on the request, and the `Mcp` case.
- `UPDATE: packages/sdk/src/host/spawn.ts:626-632` - the request carries the call's server and tool.
- `CREATE: packages/sdk/test/permissionrules-mcp.test.ts` - the `Mcp` cases.

## Steps

1. Add `mcpServerName` and `mcpToolName` to `PermissionRequest`.
2. Add the `Mcp` case to `matchesPermissionRule`, as VS Code's.
3. Fill both fields in `spawn.ts` from the call's contributor and the session's customizations.
4. Add the `Mcp` forms to the `permissions` description where ahpd copies VS Code's text.

## Validation

- `packages/sdk/test/permissionrules-mcp.test.ts` - `Mcp`, `Mcp(s)` and `Mcp(s/t)` match a call of `s`; `Mcp(other)` and a server with `/` do not.
- The sdk vitest suite passes.

## Resume

A request carries `mcpServerName` and `mcpToolName`, and `matchesPermissionRule` has VS Code's `Mcp` case. `spawn.ts` takes the server from `mcpServerOf` and the tool from what ends the call's name after its last `__`. The `permissions` text names the two `Mcp` forms in its three copies. The case is a unit test of the matcher, `permissionrules-mcp.test.ts`, since `host-permissions.test.ts` drives a whole host.
