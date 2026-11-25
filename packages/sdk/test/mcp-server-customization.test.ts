import { describe, expect, it } from 'vitest';
import { mcpServerCustomization, mcpServerIdOf } from '../src/plugins/mcpserver.js';

/*
 * The two builders this helper replaced, as they stood before the move, so the
 * test proves the ids are unchanged byte for byte: a targeted token names a
 * server by this id, and one that moved would stop reaching it.
 */
const pluginPartsBefore = (where: string, name: string): string =>
  `${where.replace(/#/g, '%23')}#mcp=${encodeURIComponent(name)}`;
const agentClaudeBefore = (uri: string, name: string): string =>
  `${uri.replaceAll('#', '%23')}#mcp=${encodeURIComponent(name)}`;

const cases: Array<[string, string]> = [
  ['file:///home/me/.claude/plugins/x/.mcp.json', 'github'],
  ['file:///p/plugin.json#frag', 'a#b'],
  ['claude-internal:/mcp/user', 'name with spaces/and&symbols'],
  ['acp-internal:/mcp/hightea', 'hightea'],
  ['file:///a##b', ''],
  ['file:///ünï', 'sérvér'],
];

describe('mcpServerIdOf', () => {
  it.each(cases)('is the id both earlier builders gave %s / %s', (uri, name) => {
    expect(mcpServerIdOf(uri, name)).toBe(pluginPartsBefore(uri, name));
    expect(mcpServerIdOf(uri, name)).toBe(agentClaudeBefore(uri, name));
  });

  it('gives the same server the same id every time it is asked', () => {
    expect(mcpServerIdOf('acp-internal:/mcp/x', 'x')).toBe(mcpServerIdOf('acp-internal:/mcp/x', 'x'));
  });
});

describe('mcpServerCustomization', () => {
  it('builds the mcpServer customization with the extra fields before the state', () => {
    const built = mcpServerCustomization('claude-internal:/mcp/user', 'gh', { kind: 'ready' }, { enablement: [{ kind: 'session', enabled: true }] });
    expect(built).toEqual({
      type: 'mcpServer',
      id: 'claude-internal:/mcp/user#mcp=gh',
      name: 'gh',
      uri: 'claude-internal:/mcp/user',
      enablement: [{ kind: 'session', enabled: true }],
      state: { kind: 'ready' },
    });
    expect(Object.keys(built)).toEqual(['type', 'id', 'name', 'uri', 'enablement', 'state']);
  });
});
