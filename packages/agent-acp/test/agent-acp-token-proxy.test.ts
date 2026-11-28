import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Bag, ComputerPort, Emit, McpServer, Session, Start } from '@ahpd/sdk';
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
async function talking(
  id: string,
  machine?: { reach: (id: string, url: string) => Promise<string | undefined> },
  before?: (session: Session) => Promise<void>,
  entry: McpServer = { type: 'http', url: at, headers: { 'x-tenant': 'acme' } },
) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-proxy-'));
  made.push(dir);
  const log = join(dir, 'requests.jsonl');
  const actions: Bag[] = [];
  const emit: Emit = (_channel, action) => { actions.push(action); };
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE], env: { ACP_LOG: log }, provider: 'acp', hostTools: false });
  const start: Start = {
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: machine === undefined ? {} : { computer: 'computer://box' },
    ...(machine === undefined ? {} : {
      computers: {
        how: async (_id: string, spawn: { command?: string; args?: string[]; env?: Record<string, string> }) => ({
          command: spawn.command,
          args: spawn.args ?? [],
          ...(spawn.env === undefined ? {} : { env: spawn.env }),
        }),
        reach: machine.reach,
      } as ComputerPort,
    }),
    schema: () => ({ type: 'object', properties: {} }),
    emit,
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    trusted: () => true,
    mcpServers: { desk: entry },
    proxyServer: (upstreamServer) => servers.openProxy(upstreamServer),
  };
  const session = await agent.create(start);
  started.push(session);
  if (before !== undefined) await before(session);
  const turn = async (turnId: string, text: string): Promise<void> => {
    const ended = () => actions.filter((one) => one.type === 'chat/turnComplete' || one.type === 'chat/turnCancelled' || one.type === 'chat/error').length;
    const before = ended();
    session.sendMessage(turnId, text);
    await until(() => ended() > before);
  };
  await turn('t1', 'hi');
  const handed = (requests(log).find((one) => one.method === 'session/new')?.params?.['mcpServers'] as Bag[])[0] as { url: string; headers: { name: string; value: string }[] };
  /** One request from the agent, to the URL and with the token it was handed. */
  const answered = async (body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'): Promise<{ status: number | undefined; said: Bag | undefined }> => {
    const answer = await servers.request(new Request(handed.url, {
      method: 'POST',
      headers: { authorization: handed.headers[0]!.value, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body,
    }));
    if (answer === undefined) return { status: undefined, said: undefined };
    const text = await answer.text();
    return { status: answer.status, said: text === '' ? undefined : JSON.parse(text) as Bag };
  };
  const call = async (): Promise<number | undefined> => (await answered()).status;
  const desk = (): Bag | undefined => session.customizations().find((one) => one.id === DESK);
  /** How many times a session's customizations were said, and with what state for the desk. */
  const publications = (): string[] => actions
    .filter((one) => one.type === 'session/customizationsChanged')
    .map((one) => String(((one.customizations as Bag[]).find((two) => two.id === DESK)?.state as Bag | undefined)?.kind));
  return { session, log, handed, call, answered, desk, turn, publications };
}

it('claims no pass-through for a machine that cannot reach the daemon', async () => {
  // The daemon is on this host's loopback, and the machine has no address for
  // it: the agent is handed the server itself, so a token given to a
  // pass-through would never reach anything.
  const { session, handed } = await talking('unreachable', { reach: async () => undefined });

  expect(handed.url).toBe(at);
  // It is connected either way: what it cannot take is a token renewed later,
  // so none is taken and it is not said ready on one it never received.
  expect(await session.authenticated?.('https://desk.example/', 'tok-1', DESK)).toBe(false);
});

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

it('takes a token before the session opens, and the pass-through sends it from the first request', async () => {
  // A client that signs in before the first turn names a server the session
  // was configured with. Nothing is opened yet, so the token is held and read
  // when the pass-through opens, instead of being refused for that reason.
  const { call } = await talking('early', undefined, async (session) => {
    expect(await session.authenticated?.('https://desk.example/', 'tok-early', DESK)).toBe(true);
  });

  await call();

  expect(seen).toEqual([{ authorization: 'Bearer tok-early', tenant: 'acme' }]);
});

it('answers a 401 with a typed error and says authRequired once, from the metadata the server named, and a token after clears it', async () => {
  const { session, call, answered, desk, publications } = await talking('refused');
  await session.authenticated?.('https://desk.example/', 'stale', DESK);
  answer = (_request, response) => {
    response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${new URL('/meta', at).href}"` });
    response.end('{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"a live turn token is required"}}');
  };

  // #38864 (@cto 2026-11-28): the refusal reaches the agent as its call's own error, at once, never as the bare
  // status - a status with no challenge is what an agent's client holds open until its own timeout.
  const starting = performance.now();
  const said = await answered();
  expect(performance.now() - starting).toBeLessThan(1000);
  expect(said.status).toBe(200);
  expect(said.said).toMatchObject({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'a live turn token is required' } });

  await until(() => (desk()?.state as Bag | undefined)?.kind === 'authRequired');
  expect(desk()?.state).toMatchObject({
    kind: 'authRequired',
    reason: 'required',
    resource: { resource: at, authorization_servers: ['https://login.example'] },
    requiredScopes: ['desk:read'],
  });
  // Said once for the requirement: a second refusal of the same token says nothing new.
  expect(await call()).toBe(200);
  expect(publications().filter((one) => one === 'authRequired')).toHaveLength(1);

  // The refused token is not sent again.
  answer = ok;
  await call();
  expect(seen.at(-1)).toEqual({ tenant: 'acme' });

  expect(await session.authenticated?.('https://desk.example/', 'fresh', DESK)).toBe(true);
  expect(desk()?.state).toEqual({ kind: 'ready' });
  await call();
  expect(seen.at(-1)).toEqual({ authorization: 'Bearer fresh', tenant: 'acme' });
});

it('answers a 403 that named a scope with a typed error, and says insufficientScope asking for that scope', async () => {
  const { session, answered, desk } = await talking('scoped');
  await session.authenticated?.('https://desk.example/', 'narrow', DESK);
  answer = (_request, response) => {
    response.writeHead(403, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="desk:write desk:read"' });
    response.end();
  };

  const said = await answered();
  expect(said.status).toBe(200);
  expect(said.said).toMatchObject({ id: 1, error: { code: -32001 } });
  expect(String((said.said?.error as Bag).message)).toContain('403');
  await until(() => (desk()?.state as Bag | undefined)?.kind === 'authRequired');
  expect(desk()?.state).toMatchObject({ kind: 'authRequired', reason: 'insufficientScope', requiredScopes: ['desk:write', 'desk:read'] });
});

it('passes a non-auth answer through unchanged, status and body', async () => {
  // Only a bearer refusal is the host's to translate; a server that broke is the agent's to see as it said it.
  const { answered, desk } = await talking('broken');
  answer = (_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"upstream is down"}}');
  };

  const said = await answered();
  expect(said.status).toBe(503);
  expect(said.said).toMatchObject({ error: { code: -32000, message: 'upstream is down' } });
  expect((desk()?.state as Bag | undefined)?.kind).not.toBe('authRequired');
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

it('starts a server the record marks as needing a person token waiting for one, with the entry\'s own URL', async () => {
  // #39198: the pipe's tools server answers `initialize` 200 with no token, so
  // the child reports it connected and no refusal ever asks the person to sign
  // in. The declaration's mark starts the wait, before the first turn.
  const { session, desk } = await talking('marked', undefined, undefined, { type: 'http', url: at, requiresClientToken: true });

  expect(desk()?.state).toMatchObject({ kind: 'authRequired', reason: 'required', resource: { resource: at } });
  // The host aims a client's token at that resource, and the pass-through sends
  // it from the next request on with the wait cleared.
  expect(await session.authenticated?.(at, 'fresh', DESK)).toBe(true);
  expect(desk()?.state).toEqual({ kind: 'ready' });
});
