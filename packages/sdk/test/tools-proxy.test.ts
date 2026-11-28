import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { toolServers } from '../src/tools/server.js';
import type { ToolsServers, UpstreamRefusal } from '../src/tools/server.js';

/*
 * The pass-through a backend is handed in place of an upstream MCP server
 * (#38500 fix 1b). The agent holds this endpoint's URL and token; the
 * upstream's token stays with the host and is read on every request.
 *
 * The upstream here is a real HTTP server on loopback, and the endpoint is
 * asked through `request`, as the daemon's listener asks it.
 */

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let upstream: Server;
let at: string;
let seen: Seen[];
/** What the upstream answers next; a test sets it. */
let answer: (request: IncomingMessage, response: ServerResponse) => void;
let servers: ToolsServers;

beforeEach(async () => {
  seen = [];
  answer = (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'up-1', 'set-cookie': 'up=1' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
  };
  upstream = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    request.on('end', () => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers, body });
      answer(request, response);
    });
  });
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve); });
  at = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`;
  servers = toolServers({ origin: () => 'http://127.0.0.1:4242' });
});

afterEach(async () => {
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => { upstream.close(() => { resolve(); }); });
});

/** A request to an endpoint, as an agent sends one. */
const asked = (url: string, token: string, init: RequestInit = {}): Promise<Response | undefined> => servers.request(new Request(url, {
  method: 'POST',
  ...init,
  headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  ...(init.method === 'GET' ? {} : { body: init.body ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
}));

it('sends the token the host holds now, so a renewal applies on the next request with no reconnect', async () => {
  let token = 'first';
  const endpoint = servers.openProxy({ url: at, tokenNow: () => token }, 'session:renewing');
  if (endpoint === undefined) throw new Error('no endpoint');

  expect((await asked(endpoint.url, endpoint.token))?.status).toBe(200);
  token = 'renewed';
  expect((await asked(endpoint.url, endpoint.token))?.status).toBe(200);

  expect(seen.map((one) => one.headers.authorization)).toEqual(['Bearer first', 'Bearer renewed']);
  // The endpoint's own token never goes upstream.
  expect(JSON.stringify(seen)).not.toContain(endpoint.token);
});

it('passes an SSE stream through as it arrives', async () => {
  let more: (() => void) | undefined;
  answer = (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'up-1' });
    response.write('event: message\ndata: {"n":1}\n\n');
    more = () => { response.end('event: message\ndata: {"n":2}\n\n'); };
  };
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't' }, 'session:streaming');
  if (endpoint === undefined) throw new Error('no endpoint');

  const response = await asked(endpoint.url, endpoint.token, { method: 'GET', headers: { accept: 'text/event-stream', 'mcp-session-id': 'up-1' } });
  expect(response?.headers.get('content-type')).toBe('text/event-stream');
  expect(response?.headers.get('mcp-session-id')).toBe('up-1');
  const reader = response!.body!.getReader();
  const decoder = new TextDecoder();
  // The first event arrives while the upstream still holds the stream open.
  expect(decoder.decode((await reader.read()).value)).toContain('"n":1');
  more?.();
  let rest = '';
  for (let part = await reader.read(); !part.done; part = await reader.read()) rest += decoder.decode(part.value);
  expect(rest).toContain('"n":2');
  expect(seen[0]?.method).toBe('GET');
  expect(seen[0]?.headers['mcp-session-id']).toBe('up-1');
});

it('says a 401, and a 403 with the scope it named, and keeps the upstream\'s challenge from the agent', async () => {
  const refusals: UpstreamRefusal[] = [];
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't', refused: (one) => { refusals.push(one); } }, 'session:refused');
  if (endpoint === undefined) throw new Error('no endpoint');

  answer = (_request, response) => {
    response.writeHead(401, { 'www-authenticate': 'Bearer resource_metadata="https://up.example/.well-known/oauth-protected-resource"' });
    response.end();
  };
  const unauthorized = await asked(endpoint.url, endpoint.token);
  answer = (_request, response) => {
    response.writeHead(403, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="tickets:write"' });
    response.end();
  };
  const forbidden = await asked(endpoint.url, endpoint.token);

  expect([unauthorized?.status, forbidden?.status]).toEqual([401, 403]);
  expect(refusals).toEqual([
    { status: 401, metadataUrl: 'https://up.example/.well-known/oauth-protected-resource' },
    { status: 403, scope: 'tickets:write' },
  ]);
  expect(unauthorized?.headers.get('www-authenticate')).toBeNull();
});

it('refuses a wrong endpoint token with 401 and sends nothing upstream', async () => {
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't' }, 'session:wrong-token');
  if (endpoint === undefined) throw new Error('no endpoint');

  expect((await asked(endpoint.url, 'not-the-token'))?.status).toBe(401);
  expect(seen).toEqual([]);
});

it('forwards only the allow-listed headers, sends the configured ones, and the upstream it opened with', async () => {
  const endpoint = servers.openProxy({ url: at, headers: { 'x-tenant': 'acme', authorization: 'Bearer configured' } }, 'session:allow-listed');
  if (endpoint === undefined) throw new Error('no endpoint');

  const response = await servers.request(new Request(`${endpoint.url}/tools/../../admin?to=http://evil.example`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${endpoint.token}`, cookie: 'daemon=secret', 'x-forwarded-for': '1.2.3.4',
      'mcp-session-id': 'up-1', 'mcp-protocol-version': '2025-06-18', 'content-type': 'application/json',
    },
    body: '{}',
  }));

  // A path past the endpoint's own is never joined onto the upstream: it is no endpoint at all.
  expect(response?.status).toBe(404);
  expect(seen).toEqual([]);

  await asked(endpoint.url, endpoint.token, { headers: { cookie: 'daemon=secret', 'x-forwarded-for': '1.2.3.4', 'mcp-session-id': 'up-1' } });
  const headers = seen[0]?.headers ?? {};
  expect(seen[0]?.url).toBe('/mcp');
  // With no token held, the configured Authorization is the one sent.
  expect(headers.authorization).toBe('Bearer configured');
  expect(headers['x-tenant']).toBe('acme');
  expect(headers['mcp-session-id']).toBe('up-1');
  expect(headers.cookie).toBeUndefined();
  expect(headers['x-forwarded-for']).toBeUndefined();
  expect(headers.host).toBe(new URL(at).host);
});

it('names the session the host opened as, and replaces one the request carried (#39153)', async () => {
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't' }, 'session:knows-its-own');
  if (endpoint === undefined) throw new Error('no endpoint');

  await asked(endpoint.url, endpoint.token, { headers: { 'x-ahpd-session': 'session:forged' } });
  await asked(endpoint.url, endpoint.token);

  // The agent's own word for the session is a claim the host never repeats, and the host's own is on every call.
  expect(seen.map((one) => one.headers['x-ahpd-session'])).toEqual(['session:knows-its-own', 'session:knows-its-own']);
});

it('refuses a redirect rather than follow it', async () => {
  answer = (_request, response) => {
    response.writeHead(307, { location: 'http://evil.example/mcp' });
    response.end();
  };
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't' }, 'session:redirect');
  if (endpoint === undefined) throw new Error('no endpoint');

  const response = await asked(endpoint.url, endpoint.token);
  expect(response?.status).toBe(502);
  expect(seen).toHaveLength(1);
});

it('answers 404 once closed, and ends a stream that was open', async () => {
  answer = (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: message\ndata: {}\n\n');
  };
  const endpoint = servers.openProxy({ url: at, tokenNow: () => 't' }, 'session:closing');
  if (endpoint === undefined) throw new Error('no endpoint');
  const open = await asked(endpoint.url, endpoint.token, { method: 'GET', headers: { accept: 'text/event-stream' } });
  const reader = open!.body!.getReader();
  await reader.read();

  endpoint.close();
  await expect((async () => { for (let part = await reader.read(); !part.done; part = await reader.read()); })()).rejects.toBeDefined();
  expect((await asked(endpoint.url, endpoint.token))?.status).toBe(404);
});
