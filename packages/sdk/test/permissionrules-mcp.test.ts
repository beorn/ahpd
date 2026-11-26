import { expect, it } from 'vitest';
import { matchesPermissionRule, permissionRuleProblem } from '../src/access/permissionrules.js';
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

/*
 * A rule that can match nothing is said by name, since the matcher answers it
 * with a plain no: `mcp__hightea__*` allowed nothing and said nothing (#38499).
 */
it('names a bare wildcard rule, and the Mcp form that would match its server', () => {
  expect(permissionRuleProblem('mcp__hightea__*')).toBe(
    'permission rule "mcp__hightea__*" matches no tool, since a wildcard is read only inside a specifier: write Mcp(hightea) for every tool of that MCP server, or Mcp(hightea/<tool>) for one',
  );
  expect(matchesPermissionRule('mcp__hightea__*', call({ toolName: 'mcp__hightea__thread_read', mcpServerName: 'hightea', mcpToolName: 'thread_read' }), context)).toBe(false);
  expect(permissionRuleProblem('Bash*')).toMatch(/^permission rule "Bash\*" matches no tool, since a wildcard is read only inside a specifier, as in Shell\(npm run \*\)$/);
});

it('names a rule that does not parse', () => {
  expect(permissionRuleProblem('Shell(npm run')).toMatch(/^permission rule "Shell\(npm run" is not a rule and matches nothing/);
  expect(permissionRuleProblem('')).toMatch(/is not a rule/);
});

it('says nothing of a rule in any form the matcher reads', () => {
  for (const rule of ['Mcp', 'Mcp(hightea)', 'Mcp(hightea/thread_read)', 'Shell(npm run *)', 'Shell(commandLine:/^git /)', 'WebFetch(example.com/docs/*)', 'Read(./src/**)', 'bash', 'mcp__hightea__thread_read', 'Edit(*)']) {
    expect(permissionRuleProblem(rule), rule).toBeUndefined();
  }
});
