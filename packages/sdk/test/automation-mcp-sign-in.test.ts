import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryAutomations } from '../src/automations/automations.js';
import { createHost, ROOT } from '../src/host.js';
import { bag } from '../src/utils/values.js';
import { echo, hello, peer, settle } from './support/host.js';
import { directory } from './users-gate-helpers.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { Emit, Session } from '../src/types/session.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * An automation's MCP sign-in, asked of the automation owner's clients.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1652-L1686
 */

const ONE = 'ahp-automation:/sign-in';
const AUTOMATIONS = 'ahp-automations://';

/** The record the host advertises to a person who signs in. */
const USERS_RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.com'],
  required: false,
};

/** A directory of people, each holding the grants it names. */
const users = (tokens: Record<string, Grant[]>): Users => ({ ...directory(tokens), resource: USERS_RECORD });

/** What a person needs to write an automation and press Run. */
const OWNER: Grant[] = ['automation:*', 'session:*'];

/** The challenge a server publishes when it needs a sign-in. */
const AUTH: Bag = {
  kind: 'authRequired',
  reason: 'required',
  resource: {
    resource: 'https://mcp.example.com/mcp',
    authorization_servers: ['https://example.com'],
    scopes_supported: ['read'],
  },
  requiredScopes: ['read'],
};

/** One MCP server a session publishes, needing the sign-in above. */
const server = (over: Bag = {}): Bag => ({
  type: 'mcpServer', id: 'srv', uri: 'claude-internal:/mcp/one', name: 'one', state: AUTH, ...over,
});

/** A plugin a connector owns, carrying a server of its own that needs a sign-in. */
const fromConnector = (): Bag => ({
  type: 'plugin',
  id: 'plugin:/one',
  uri: 'file:///plugins/one',
  name: 'One',
  children: [{ type: 'mcpServer', id: 'plugin:/one#mcp=owned', uri: 'file:///plugins/one', name: 'owned', state: AUTH }],
});

/** A session the echo backend built, and the road to say what its session changes. */
interface Started {
  uri: string;
  emit: Emit;
}

/**
 * The echo backend, with every session it starts kept.
 *
 * The host's own actions are the ones that move a session's customizations, so
 * a case says them through the backend's `emit` - the road a backend reporting
 * one takes, rather than a client's.
 */
function signing(path: string) {
  const base = echo({ path, pace: 0 });
  const started: Started[] = [];
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    create: (given: Start) => {
      const session = base.create(given) as Session;
      started.push({ uri: given.uri, emit: given.emit });
      return session;
    },
  };
  return { agent, started };
}

type Backend = ReturnType<typeof signing>;

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A host with people in it, and a backend whose sessions a case can move. */
async function served(tokens: Record<string, Grant[]> = { ana: OWNER, bob: OWNER }) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-sign-in-'));
  made.push(dir);
  const backend = signing(dir);
  const store = memoryAutomations();
  const host = createHost({
    path: dir, agents: [backend.agent], users: users(tokens), automations: store,
  });
  hosts.push(host);
  return { host, backend, store };
}

/**
 * A client that has said hello under `clientId`, and signed in as `token`
 * where one is named.
 *
 * The id is the client's own because a client id is the first person's who
 * signed in under it: two people never share one, and a second connection of
 * one person says a different one.
 */
async function joined(host: ReturnType<typeof createHost>, clientId: string, token?: string, p: Peer = peer()) {
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { clientId }));
  if (token !== undefined) {
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: USERS_RECORD.resource, token } });
  }
  return client;
}

/**
 * A client that answers the host's questions from `answer`, and keeps every
 * MCP authentication it was asked, in the order the host asked the windows.
 */
function asking(label: string, order: string[], answer: (params: Bag) => unknown) {
  const asked: Bag[] = [];
  const p: Peer = {
    send: () => {}, notify: () => {}, answered: () => {}, close: () => {},
    request: async (method, params) => {
      if (method !== 'vscode/requestMcpAuthentication') return {};
      order.push(label);
      asked.push(params as Bag);
      return answer(params as Bag);
    },
  };
  return { peer: p, asked };
}

/** One automation whose runs start an echo session. */
const definition = (): Bag => ({
  title: 'Sign in',
  enabled: true,
  message: { text: 'Start' },
  session: { provider: 'echo' },
});

/** Wait until `ready` holds, for at most five seconds. */
const until = async (ready: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + 5000;
  while (!ready() && Date.now() < deadline) await new Promise((done) => { setTimeout(done, 5); });
  return ready();
};

/**
 * Write the automation as the client that owns it, and press Run.
 *
 * `runAutomation` answers with the run it recorded and starts that run in the
 * background, so the session is waited for rather than read on the answer.
 */
async function automated(
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  backend: Backend,
  store: ReturnType<typeof memoryAutomations>,
) {
  const before = backend.started.length;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: AUTOMATIONS, action: { type: 'automation/createRequested', resource: ONE, definition: definition() } },
  });
  const asked = await client.handle({ method: 'runAutomation', params: { channel: AUTOMATIONS, automation: ONE, requestId: 'r' } }) as {
    resource: string;
  };
  if (!await until(() => backend.started.length > before)) {
    const lifecycle = bag(store.runOf?.(asked.resource)?.lifecycle);
    const why = bag(lifecycle.error).message;
    throw new Error(`the automation did not start a session: ${String(lifecycle.status)}${why === undefined ? '' : `: ${String(why)}`}`);
  }
  const run = backend.started[before];
  if (run === undefined) throw new Error('the automation did not start a session');
  await settle(4);
  return run;
}

/** Say what a session's customizations are now. */
const published = (session: Started, customizations: Bag[]): void => {
  session.emit('session', { type: 'session/customizationsChanged', customizations });
};

/** Say one server's state, as the backend reporting it does. */
const stateOf = (session: Started, id: string, state: Bag): void => {
  session.emit('session', { type: 'session/mcpServerStateChanged', id, state });
};

describe("an automation's MCP sign-in", () => {
  it("asks the owner's clients in turn, and the first sign-in ends the round", async () => {
    const { host, backend, store } = await served();
    const order: string[] = [];
    const first = asking('ana-1', order, () => ({ authenticated: false }));
    const second = asking('ana-2', order, () => ({ authenticated: true }));
    const other = asking('bob', order, () => ({ authenticated: true }));
    const ana1 = await joined(host, 'ana-1', 'ana', first.peer);
    await joined(host, 'ana-2', 'ana', second.peer);
    await joined(host, 'bob-1', 'bob', other.peer);

    const run = await automated(ana1, backend, store);
    published(run, [server()]);
    await settle(10);

    expect(order).toEqual(['ana-1', 'ana-2']);
    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(1);
    expect(first.asked[0]).toEqual({
      target: { kind: 'mcpServer', session: run.uri, customizationId: 'srv' },
      serverName: 'one',
      auth: { reason: 'required', resource: AUTH.resource, requiredScopes: ['read'] },
    });
    // Another person's connection is not asked about this automation.
    expect(other.asked).toEqual([]);
  });

  it('asks one challenge once, however often the server says it', async () => {
    const { host, backend, store } = await served();
    const order: string[] = [];
    const first = asking('ana-1', order, () => ({ authenticated: false }));
    const second = asking('ana-2', order, () => ({ authenticated: false }));
    const ana1 = await joined(host, 'ana-1', 'ana', first.peer);
    await joined(host, 'ana-2', 'ana', second.peer);

    const run = await automated(ana1, backend, store);
    published(run, [server()]);
    await settle(10);
    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(1);

    // The same challenge again, through the narrower action a backend reports
    // one server's state with.
    stateOf(run, 'srv', AUTH);
    await settle(10);
    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(1);
  });

  it('asks again once the server has left the challenge and come back to it', async () => {
    const { host, backend, store } = await served();
    const order: string[] = [];
    const first = asking('ana-1', order, () => ({ authenticated: false }));
    const second = asking('ana-2', order, () => ({ authenticated: false }));
    const ana1 = await joined(host, 'ana-1', 'ana', first.peer);
    await joined(host, 'ana-2', 'ana', second.peer);

    const run = await automated(ana1, backend, store);
    published(run, [server()]);
    await settle(10);
    expect(first.asked).toHaveLength(1);

    stateOf(run, 'srv', { kind: 'ready' });
    await settle(4);
    stateOf(run, 'srv', AUTH);
    await settle(10);

    expect(first.asked).toHaveLength(2);
    expect(second.asked).toHaveLength(2);
  });

  it('does not ask a server a connector owns', async () => {
    const { host, backend, store } = await served();
    const order: string[] = [];
    const first = asking('ana-1', order, () => ({ authenticated: false }));
    const second = asking('ana-2', order, () => ({ authenticated: true }));
    const ana1 = await joined(host, 'ana-1', 'ana', first.peer);
    await joined(host, 'ana-2', 'ana', second.peer);

    const run = await automated(ana1, backend, store);
    published(run, [fromConnector(), server()]);
    await settle(10);

    // The plugin's server is not asked; the session's own is.
    expect(first.asked.map((one) => one.serverName)).toEqual(['one']);
    expect(second.asked.map((one) => one.serverName)).toEqual(['one']);
  });

  it("does not ask about a session no automation runs", async () => {
    const { host, backend } = await served();
    const order: string[] = [];
    const first = asking('ana-1', order, () => ({ authenticated: true }));
    const ana1 = await joined(host, 'ana-1', 'ana', first.peer);

    const uri = 'ahp-session:/mine';
    await ana1.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    const mine = backend.started.find((one) => one.uri === uri);
    if (mine === undefined) throw new Error('the session was not started');
    published(mine, [server()]);
    await settle(10);

    expect(first.asked).toEqual([]);
  });
});
