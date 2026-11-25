import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpServerCustomization, mcpServerIdOf, protectedResource } from '../src/plugins/mcpserver.js';

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
  it('builds the mcpServer customization with the extra fields first', () => {
    const built = mcpServerCustomization('claude-internal:/mcp/user', 'gh', { kind: 'ready' }, { enablement: [{ kind: 'session', enabled: true }] });
    expect(built).toEqual({
      type: 'mcpServer',
      id: 'claude-internal:/mcp/user#mcp=gh',
      name: 'gh',
      uri: 'claude-internal:/mcp/user',
      enablement: [{ kind: 'session', enabled: true }],
      state: { kind: 'ready' },
    });
    expect(Object.keys(built)).toEqual(['enablement', 'type', 'id', 'name', 'uri', 'state']);
  });

  it('lets an extra field add to the customization and never replace what names it', () => {
    const built = mcpServerCustomization('acp-internal:/mcp/a', 'a', { kind: 'ready' }, { id: 'other', type: 'skill', name: 'b', uri: 'x:', state: { kind: 'stopped' } });
    expect(built).toMatchObject({ type: 'mcpServer', id: 'acp-internal:/mcp/a#mcp=a', name: 'a', uri: 'acp-internal:/mcp/a', state: { kind: 'ready' } });
  });
});

describe('protectedResource with the metadata URL a server named', () => {
  let server: Server;
  let origin: string;
  const asked: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      asked.push(request.url ?? '');
      const send = (status: number, body?: unknown, headers: Record<string, string> = {}): void => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(body === undefined ? undefined : JSON.stringify(body));
      };
      if (request.url === '/named-meta') send(200, { resource: `${origin}/mcp`, authorization_servers: ['https://named.example'] });
      else if (request.url === '/moved-meta') send(302, undefined, { location: `${origin}/named-meta` });
      else if (request.url === '/.well-known/oauth-protected-resource/mcp') send(200, { resource: `${origin}/mcp`, authorization_servers: ['https://wellknown.example'] });
      else send(404);
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve(); }); }); });

  it('asks the URL the server named first', async () => {
    expect(await protectedResource(`${origin}/mcp`, 'up', 5_000, `${origin}/named-meta`))
      .toMatchObject({ authorization_servers: ['https://named.example'] });
  });

  it('never follows a redirect from the named URL, and falls back to the well-known path', async () => {
    asked.length = 0;
    expect(await protectedResource(`${origin}/mcp`, 'up', 5_000, `${origin}/moved-meta`))
      .toMatchObject({ authorization_servers: ['https://wellknown.example'] });
    expect(asked).not.toContain('/named-meta');
  });

  it('does not ask a named URL that is plain http off this machine', async () => {
    asked.length = 0;
    expect(await protectedResource(`${origin}/mcp`, 'up', 5_000, 'http://upstream.invalid/meta'))
      .toMatchObject({ authorization_servers: ['https://wellknown.example'] });
  });
});
