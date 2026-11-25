import { expect, it } from 'vitest';
import { matchesPermissionRule } from '../src/access/permissionrules.js';
import type { PermissionRequest } from '../src/access/permissionrules.js';

/*
 * `Mcp`, `Mcp(<server>)` and `Mcp(<server>/<tool>)`, as VS Code main's
 * matcher reads them against a request's server and tool.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/permissionRules.ts#L118-L123
 */
const context = { homeDirectory: '/home/someone' };
const call = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  kind: 'mcp', toolName: 'mcp__github__create_issue', mcpServerName: 'github', mcpToolName: 'create_issue', ...over,
});
/** An MCP call whose server the session's customizations do not name. */
const unnamed: PermissionRequest = { kind: 'mcp', toolName: 'mcp__github__create_issue' };

it('matches an MCP call by Mcp, by its server and by its server and tool', () => {
  expect(matchesPermissionRule('Mcp', call(), context)).toBe(true);
  expect(matchesPermissionRule('Mcp(github)', call(), context)).toBe(true);
  expect(matchesPermissionRule('Mcp(github/create_issue)', call(), context)).toBe(true);
});

it('does not match another server, another tool, or a call that is not an MCP one', () => {
  expect(matchesPermissionRule('Mcp(gitlab)', call(), context)).toBe(false);
  expect(matchesPermissionRule('Mcp(github/delete_repo)', call(), context)).toBe(false);
  expect(matchesPermissionRule('Mcp', call({ kind: 'shell' }), context)).toBe(false);
});

it('matches no server rule for a call with no server, or a server whose name has a slash', () => {
  expect(matchesPermissionRule('Mcp(github)', unnamed, context)).toBe(false);
  expect(matchesPermissionRule('Mcp(a/b)', { kind: 'mcp', toolName: 'x', mcpServerName: 'a/b' }, context)).toBe(false);
  // A bare `Mcp` still names every MCP call.
  expect(matchesPermissionRule('Mcp', unnamed, context)).toBe(true);
});
