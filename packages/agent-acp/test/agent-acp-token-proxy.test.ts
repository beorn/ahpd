import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Bag, Emit, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { toolServers } from '../../sdk/src/tools/server.js';
import type { ToolsServers } from '../../sdk/src/tools/server.js';
import { acpAgent } from '../src/index.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * A token a client renews reaching an HTTP MCP server an ACP agent was handed
 * once, when its session opened (#38500 fix 1b). The agent is given the
 * host's pass-through instead of the server; the token stays with the host,
 * and the next request carries the newest one.
 *
 * The ACP server is the real fixture, the pass-through is the host's own tools
 * server, and the upstream is a real HTTP server on loopback. This test plays
 * the agent: it calls the URL and token the session handed it.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));
const DESK = 'acp-internal:/mcp/desk#mcp=desk';

const made: string[] = [];
const started: Session[] = [];
let upstream: Server;
let at: string;
let seen: { authorization?: string; tenant?: string }[];
let answer: (request: IncomingMessage, response: ServerResponse) => void;
let servers: ToolsServers;

const ok = (_request: IncomingMessage, response: ServerResponse): void => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
};

beforeEach(async () => {
  seen = [];
  answer = ok;
  upstream = createServer((request, response) => {
    if (request.url === '/meta') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ resource: at, authorization_servers: ['https://login.example'], scopes_supported: ['desk:read'] }));
      return;
    }
    request.resume();
    request.on('end', () => {
      seen.push({
        ...(request.headers.authorization === undefined ? {} : { authorization: request.headers.authorization }),
        ...(typeof request.headers['x-tenant'] === 'string' ? { tenant: request.headers['x-tenant'] } : {}),
      });
      answer(request, response);
    });
  });
  await new Promise<void>((resolve) => { upstream.listen(0, '127.0.0.1', resolve); });
  at = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`;
  servers = toolServers({ origin: () => 'http://127.0.0.1:4242' });
});

afterEach(async () => {
  for (const session of started.splice(0)) session.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => { upstream.close(() => { resolve(); }); });
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

const requests = (log: string): { method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
  }
  catch {
    return [];
  }
};

/** A session over the fixture, with one configured HTTP server and the host's pass-through. */
async function talking(id: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-proxy-'));
  made.push(dir);
  const log = join(dir, 'requests.jsonl');
  const actions: Bag[] = [];
  const emit: Emit = (_channel, action) => { actions.push(action); };
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: log }, provider: 'acp', hostTools: false });
  const start: Start = {
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit,
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    trusted: () => true,
    mcpServers: { desk: { type: 'http', url: at, headers: { 'x-tenant': 'acme' } } },
    proxyServer: (upstreamServer) => servers.openProxy(upstreamServer),
  };
  const session = await agent.create(start);
  started.push(session);
  const turn = async (turnId: string, text: string): Promise<void> => {
    const ended = () => actions.filter((one) => one.type === 'chat/turnComplete' || one.type === 'chat/turnCancelled' || one.type === 'chat/error').length;
    const before = ended();
    session.sendMessage(turnId, text);
    await until(() => ended() > before);
  };
  await turn('t1', 'hi');
  const handed = (requests(log).find((one) => one.method === 'session/new')?.params?.['mcpServers'] as Bag[])[0] as { url: string; headers: { name: string; value: string }[] };
  /** One request from the agent, to the URL and with the token it was handed. */
  const call = async (): Promise<number | undefined> => (await servers.request(new Request(handed.url, {
    method: 'POST',
    headers: { authorization: handed.headers[0]!.value, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  })))?.status;
  const desk = (): Bag | undefined => session.customizations().find((one) => one.id === DESK);
  return { session, log, handed, call, desk, turn };
}

it('hands the agent the pass-through, never the server or its token', async () => {
  const { handed } = await talking('handed');

  expect(handed.url).toMatch(/^http:\/\/127\.0\.0\.1:4242\/ahp-mcp\//u);
  expect(handed.url).not.toContain(new URL(at).port);
  expect(handed.headers).toHaveLength(1);
  expect(handed.headers[0]?.name).toBe('authorization');
  expect(handed.headers[0]?.value).not.toContain('acme');
});

it('sends a targeted token from the next request on, and a renewal from the one after, with no reconnect', async () => {
  const { session, call, log } = await talking('renewed');

  expect(await session.authenticated?.('https://desk.example/', 'tok-1', DESK)).toBe(true);
  await call();
  expect(await session.authenticated?.('https://desk.example/', 'tok-2', DESK)).toBe(true);
  await call();

  expect(seen).toEqual([{ authorization: 'Bearer tok-1', tenant: 'acme' }, { authorization: 'Bearer tok-2', tenant: 'acme' }]);
  // The session was opened once: the renewal reached the server without one.
  expect(requests(log).filter((one) => one.method === 'session/new' || one.method === 'session/load' || one.method === 'session/resume')).toHaveLength(1);
});

it('says a 401 as authRequired, from the metadata the server named, and a token after clears it', async () => {
  const { session, call, desk } = await talking('refused');
  await session.authenticated?.('https://desk.example/', 'stale', DESK);
  answer = (_request, response) => {
    response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${new URL('/meta', at).href}"` });
    response.end();
  };

  expect(await call()).toBe(401);
  await until(() => (desk()?.state as Bag | undefined)?.kind === 'authRequired');
  expect(desk()?.state).toMatchObject({
    kind: 'authRequired',
    reason: 'required',
    resource: { resource: at, authorization_servers: ['https://login.example'] },
    requiredScopes: ['desk:read'],
  });

  // The refused token is not sent again.
  answer = ok;
  await call();
  expect(seen.at(-1)).toEqual({ tenant: 'acme' });

  expect(await session.authenticated?.('https://desk.example/', 'fresh', DESK)).toBe(true);
  expect(desk()?.state).toEqual({ kind: 'ready' });
  await call();
  expect(seen.at(-1)).toEqual({ authorization: 'Bearer fresh', tenant: 'acme' });
});

it('says a 403 that named a scope as insufficientScope, asking for that scope', async () => {
  const { session, call, desk } = await talking('scoped');
  await session.authenticated?.('https://desk.example/', 'narrow', DESK);
  answer = (_request, response) => {
    response.writeHead(403, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="desk:write desk:read"' });
    response.end();
  };

  expect(await call()).toBe(403);
  await until(() => (desk()?.state as Bag | undefined)?.kind === 'authRequired');
  expect(desk()?.state).toMatchObject({ kind: 'authRequired', reason: 'insufficientScope', requiredScopes: ['desk:write', 'desk:read'] });
});

it('says a token that ran out as expired, and stops sending it', async () => {
  const { session, call, desk } = await talking('expired');
  await session.authenticated?.('https://desk.example/', 'short', DESK);

  expect(await session.expired?.('https://desk.example/', DESK)).toBe(true);
  expect(desk()?.state).toMatchObject({ kind: 'authRequired', reason: 'expired' });
  await call();
  expect(seen.at(-1)).toEqual({ tenant: 'acme' });
});

it('keeps the same pass-through across a server that died, holding the token it had', async () => {
  const { session, call, log, handed, turn } = await talking('respawn');
  await session.authenticated?.('https://desk.example/', 'kept', DESK);
  await turn('t2', 'die now');
  await turn('t3', 'hi again');

  const again = (requests(log).find((one) => one.method === 'session/resume')?.params?.['mcpServers'] as Bag[])[0];
  expect(again).toEqual(handed);
  await call();
  expect(seen.at(-1)).toEqual({ authorization: 'Bearer kept', tenant: 'acme' });
});
