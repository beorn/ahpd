import { WAIT_MS } from '../../../tools/wait.ts';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { echo, machine } from './support/host.js';
import { directory, hello, peer, signIn } from './users-gate-helpers.js';
import { WORK } from './support/work.js';
import { uriOf } from '../src/resources/fileuri.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';
import type { HostOptions } from '../src/types/host.js';

/*
 * A chat on an agent of its own, AHP 1.1.0's `multipleChatProviders`: on until
 * the root config turns it off, refused in VS Code's words, and no way round
 * what a session started on that agent is asked.
 */

const URI = 'ahp-session:/s';
const CHAT = 'ahp-chat:/0f8fad5b-d9cb-469f-a165-70867728950e';
const NEXT = 'ahp-chat:/1f8fad5b-d9cb-469f-a165-70867728950e';
const KEY = 'multipleChatProviders.enabled';

/** A backend with a key of its own a chat may set, recording every chat it starts. */
const other = (starts: Start[]): Agent => {
  const base = echo({ path: WORK, pace: 0 });
  return {
    ...base,
    provider: 'other',
    chats: { fork: true, sideChat: true },
    schema: () => {
      const schema = base.schema();
      return { ...schema, properties: {
        ...(schema.properties as Record<string, Record<string, unknown>>),
        voice: { type: 'string', title: 'Voice', enum: ['low', 'loud'], default: 'low', chatMutable: true },
        room: { type: 'string', title: 'Room' },
      } };
    },
    /*
     * A chat of its own is a conversation of its own, under the id it was
     * started with, as a real backend's is. The echo example answers its
     * session's id for every chat, and this fork records the id a backend
     * answers as soon as it has one (spawn.ts `keepBackendId`), so without
     * this the chat would be recorded as the session's own conversation
     * (#463 sync).
     */
    create: (start: Start) => {
      starts.push(start);
      const made = base.create(start) as Session;
      return start.chatId === undefined ? made : { ...made, agentId: () => start.chatId! };
    },
  };
};

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;
const made = async (over: Partial<HostOptions> = {}, starts: Start[] = []) => {
  const sessions = memorySessions();
  const options: HostOptions = {
    path: WORK, agents: [echo({ path: WORK, pace: 0 }), other(starts)], ...machine(), sessions, ...over,
  };
  const host = createHost(options);
  const client = host.accept(peer());
  const said = await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['1.1.0'], initialSubscriptions: ['ahp-root://'] } }) as Record<string, unknown>;
  return { host, client, starts, sessions, options, said };
};
const session = (client: Client) => client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
const chat = (client: Client, more: Record<string, unknown> = { provider: 'other' }, uri = CHAT) =>
  client.handle({ method: 'createChat', params: { channel: URI, chat: uri, ...more } });
const state = async (client: Client, channel: string) =>
  (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Record<string, unknown> } }).snapshot.state;
/** One whole turn in the session's own chat, after which the session is listed and kept. */
const used = async (client: Client) => {
  const main = (await state(client, URI)).defaultChat as string;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: main, clientSeq: 9, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } } },
  });
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const now = await state(client, main) as { turns: unknown[]; activeTurn?: unknown };
    if (now.turns.length === 1 && now.activeTurn === undefined) return;
    if (Date.now() > until) throw new Error('the turn never ended');
    await new Promise((r) => { setTimeout(r, 10); });
  }
};
const rootSet = (client: Client, value: boolean) => client.handle({
  method: 'dispatchAction', params: { channel: 'ahp-root://', clientSeq: 1, action: { type: 'root/configChanged', config: { [KEY]: value } } },
});
const initialized = async (host: ReturnType<typeof createHost>, version: string) =>
  await host.accept(peer()).handle({ method: 'initialize', params: { clientId: `at-${version}`, protocolVersions: [version] } }) as Record<string, unknown>;

it('says it serves chats of other agents to a client of 1.1.0, while the setting is on', async () => {
  const { host, client, said } = await made();
  expect(said.multipleChatProviders).toEqual({});
  expect(await initialized(host, '1.0.0')).not.toHaveProperty('multipleChatProviders');
  await rootSet(client, false);
  expect(await initialized(host, '1.1.0')).not.toHaveProperty('multipleChatProviders');
  await rootSet(client, true);
  expect((await initialized(host, '1.1.0')).multipleChatProviders).toEqual({});
});

it('makes the chat on the agent it asks for, and says so on its state and its rows', async () => {
  const { client, starts } = await made();
  await session(client);
  await used(client);
  await chat(client);
  expect(starts).toHaveLength(1);
  expect((await state(client, CHAT)).provider).toBe('other');
  const held = await state(client, URI) as { provider: string; chats: { resource: string; provider?: string }[] };
  expect(held.provider).toBe('echo');
  expect(held.chats.find((one) => one.resource === CHAT)?.provider).toBe('other');
  const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: { resource: string; chats?: { resource: string; provider?: string }[] }[] };
  expect(rows.items.find((one) => one.resource === URI)?.chats?.find((one) => one.resource === CHAT)?.provider).toBe('other');
});

it('makes an ordinary chat of the session\'s own agent named', async () => {
  const { client, starts } = await made();
  await session(client);
  await chat(client, { provider: 'echo' });
  expect(starts).toHaveLength(0);
  expect(await state(client, CHAT)).not.toHaveProperty('provider');
});

it('gives the chat its agent\'s own schema, and checks a write against it', async () => {
  const { client, starts } = await made();
  await session(client);
  await chat(client);
  const config = (await state(client, CHAT)).config as { schema: { properties: Record<string, unknown> }; values: Record<string, unknown> };
  expect(Object.keys(config.schema.properties)).toEqual(['voice']);
  const write = (values: Record<string, unknown>) => client.handle({
    method: 'dispatchAction', params: { channel: CHAT, clientSeq: 2, action: { type: 'chat/configChanged', config: values } },
  });
  await write({ voice: 'loud' });
  expect(((await state(client, CHAT)).config as typeof config).values).toMatchObject({ voice: 'loud' });
  await write({ room: 'kitchen' });
  await write({ voice: 'shrill' });
  expect(((await state(client, CHAT)).config as typeof config).values).toEqual({ voice: 'loud' });
  expect(starts).toHaveLength(1);
});

it('refuses it in VS Code\'s words', async () => {
  const off = new Set<string>();
  const { client, starts } = await made({ disabledAgents: () => off });
  await session(client);
  await expect(chat(client, { provider: 'nobody' })).rejects.toMatchObject({ code: -32602, message: 'Agent nobody is unknown or disabled.' });
  const main = (await state(client, URI)).defaultChat as string;
  await expect(chat(client, { provider: 'other', initialMessage: { text: 'hi', origin: { kind: 'user' } } }, main))
    .rejects.toMatchObject({ code: -32602, message: 'The default chat uses its session\'s agent.' });
  await expect(chat(client, { provider: 'other', source: { kind: 'fork', chat: main, turnId: 't' } }))
    .rejects.toMatchObject({ code: -32602, message: 'A fork or side chat uses its source chat\'s agent.' });
  off.add('other');
  await expect(chat(client)).rejects.toMatchObject({ code: -32002 });
  off.clear();
  await rootSet(client, false);
  await expect(chat(client)).rejects.toMatchObject({ code: -32602, message: 'This host does not support chats with their own agent.' });
  expect(starts).toHaveLength(0);
});

it('keeps the source chat\'s agent for a chat cut out of it', async () => {
  const { client, starts } = await made();
  await session(client);
  await chat(client);
  await chat(client, { source: { kind: 'fork', chat: CHAT, turnId: 'none' } }, NEXT);
  expect(starts).toHaveLength(2);
  expect((await state(client, NEXT)).provider).toBe('other');
});

it('answers an agent the person may not use as one it does not hold', async () => {
  const starts: Start[] = [];
  const host = createHost({
    path: WORK, agents: [echo({ path: WORK, pace: 0 }), other(starts)], ...machine(), sessions: memorySessions(),
    users: directory({ soft: ['session:*', 'chat:*'] }),
    agentOwners: () => new Map([['other', 'user:somebody']]),
  });
  const client = host.accept(peer());
  await hello(client, 'soft');
  await signIn(client, 'soft');
  await session(client);
  await expect(chat(client)).rejects.toMatchObject({ code: -32602, message: 'Agent other is unknown or disabled.' });
  expect(starts).toHaveLength(0);
});

it('starts the chat on its own agent again after a restart', async () => {
  const first = await made();
  await session(first.client);
  await used(first.client);
  await chat(first.client);
  await first.host.close();
  const starts: Start[] = [];
  const listed = (agent: Agent): Agent => ({
    ...agent,
    list: async () => [{ id: 's', title: 'Kept', createdAt: '2026-11-24T00:00:00.000Z', modifiedAt: '2026-11-24T00:00:00.000Z', workingDirectories: [uriOf(WORK)] }],
    transcript: async () => [],
  });
  // Each agent's own conversations: the chat's are the other's.
  const asked: string[] = [];
  const back = { ...other(starts), transcript: async (id: string) => {
    asked.push(id);
    return [{ id: 'o1', startedAt: '2026-11-24T00:00:00.000Z', message: { text: 'in its own', origin: { kind: 'user' as const } }, state: 'complete' as const, responseParts: [] }];
  } } as unknown as Agent;
  const host = createHost({ ...first.options, agents: [listed(echo({ path: WORK, pace: 0 })), back] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'again', protocolVersions: ['1.1.0'] } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  const rows = (await state(client, URI)).chats as { resource: string; provider?: string }[];
  expect(rows.find((one) => one.resource === CHAT)?.provider).toBe('other');
  const again = await state(client, CHAT);
  expect(again).toMatchObject({ provider: 'other', turns: [{ id: 'o1' }] });
  expect(asked).toEqual(['0f8fad5b-d9cb-469f-a165-70867728950e']);
  // And a turn in it starts it there.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: 'go on', origin: { kind: 'user' } } } },
  });
  const until = Date.now() + WAIT_MS;
  while (starts.length === 0 && Date.now() < until) await new Promise((r) => { setTimeout(r, 10); });
  expect(starts).toHaveLength(1);
  await host.close();
});
