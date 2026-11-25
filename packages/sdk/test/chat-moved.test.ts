import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A chat that moves to another session says where it went, AHP 1.1.0's
 * `chat/moved`, and keeps its agent in a session of another while chats with
 * their own agents are on.
 */

const ROOT = 'ahp-root://';
const A = 'ahp-session:/a';
const B = 'ahp-session:/b';
const CHAT = 'ahp-chat:/0f8fad5b-d9cb-469f-a165-70867728950e';

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** An echo backend under a name of its own, with a key a chat may set, recording its starts. */
const named = (dir: string, provider: string, key: string, starts: Start[]): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    provider,
    schema: () => {
      const schema = base.schema();
      return { ...schema, properties: {
        ...(schema.properties as Record<string, Record<string, unknown>>),
        [key]: { type: 'string', title: key, enum: ['low', 'loud'], default: 'low', chatMutable: true },
      } };
    },
    create: (start: Start) => {
      starts.push(start);
      // A name of its own for each chat's conversation, as a backend keeps one.
      return { ...base.create(start) as Session, agentId: () => `${provider}-${start.chatUri.slice(-12)}` };
    },
  };
};

type Said = { channel: string; action: Record<string, unknown> };
const serving = async (versions = ['1.1.0']) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-moved-')));
  made.push(dir);
  const starts = { one: [] as Start[], two: [] as Start[] };
  const sessions = memorySessions();
  const host = createHost({ path: dir, sessions, agents: [named(dir, 'one', 'voice', starts.one), named(dir, 'two', 'tone', starts.two)] });
  hosts.push(host);
  const said: Said[] = [];
  const peer: Peer = {
    send: () => {}, request: async () => ({ trusted: true }), answered: () => {}, close: () => {},
    notify: (method, params) => { if (method === 'action') said.push(params as Said); },
  };
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'move', protocolVersions: versions } });
  const root = (config: Record<string, unknown>) => client.handle({
    method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config } },
  });
  await root({ 'chatMoves.enabled': true });
  const state = async (channel: string) =>
    (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Record<string, unknown> } }).snapshot.state;
  const turn = async (chat: string, id: string) => {
    const before = ((await state(chat)).turns as unknown[]).length;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: id, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; ((await state(chat)).turns as unknown[]).length === before;) {
      if (Date.now() > until) throw new Error('the turn never ended');
      await new Promise((r) => { setTimeout(r, 10); });
    }
  };
  const session = (channel: string, provider: string) => client.handle({ method: 'createSession', params: { channel, provider } });
  const peerChat = async (provider?: string) => {
    await client.handle({ method: 'createChat', params: { channel: A, chat: CHAT, ...(provider === undefined ? {} : { provider }) } });
    await turn(CHAT, 't1');
  };
  const move = (destination: Record<string, unknown>) =>
    client.handle({ method: 'moveChat', params: { channel: CHAT, destination } }) as Promise<{ session: string }>;
  const moved = () => said.filter((one) => one.channel === CHAT && one.action.type === 'chat/moved').map((one) => one.action);
  const rowIn = async (channel: string) => ((await state(channel)).chats as { resource: string; provider?: string }[]).find((one) => one.resource === CHAT);
  return { host, client, root, state, turn, session, peerChat, move, moved, rowIn, starts, sessions };
};

it('says where a chat went, with no agent of its own in a session of the same agent', async () => {
  const at = await serving();
  await at.session(A, 'one');
  await at.session(B, 'one');
  await at.peerChat();
  await at.move({ kind: 'session', session: B });
  expect(at.moved()).toEqual([{ type: 'chat/moved', session: B }]);
  expect(await at.state(CHAT)).not.toHaveProperty('provider');
});

it('does not say it to a client of 1.0.0', async () => {
  const at = await serving(['1.0.0']);
  await at.session(A, 'one');
  await at.session(B, 'one');
  await at.peerChat();
  await at.move({ kind: 'session', session: B });
  expect(at.moved()).toEqual([]);
  expect(await at.rowIn(B)).toBeDefined();
});

it('moves a chat to a session of another agent, and it keeps its own there', async () => {
  const at = await serving();
  await at.session(A, 'one');
  await at.session(B, 'two');
  await at.peerChat();
  await at.client.handle({ method: 'dispatchAction', params: { channel: CHAT, clientSeq: 1, action: { type: 'chat/configChanged', config: { voice: 'loud' } } } });
  await at.move({ kind: 'session', session: B });
  expect(at.moved()).toMatchObject([{ session: B, provider: 'one', schema: { properties: { voice: {} } } }]);
  expect(await at.state(CHAT)).toMatchObject({ provider: 'one', config: { schema: { properties: { voice: {} } }, values: { voice: 'loud' } } });
  expect((await at.rowIn(B))?.provider).toBe('one');
  // What a client holding the state has is what a new one reads.
  expect(Object.keys(((await at.state(CHAT)).config as { schema: { properties: object } }).schema.properties)).toEqual(['voice']);
  // And its next turn runs on its own agent, which takes its conversation back.
  const { one, two } = { one: at.starts.one.length, two: at.starts.two.length };
  await at.turn(CHAT, 't2');
  expect(at.starts.one.length).toBe(one + 1);
  expect(at.starts.two.length).toBe(two);
  expect(at.starts.one.at(-1)?.settings).toMatchObject({ voice: 'loud' });
  expect(at.sessions.chats?.('b')?.find((row) => row.uri === CHAT)?.provider).toBe('one');
});

it('takes a chat back to a session of its own agent, as one of that session\'s', async () => {
  const at = await serving();
  await at.session(A, 'one');
  await at.session(B, 'two');
  await at.peerChat('two');
  await at.client.handle({ method: 'dispatchAction', params: { channel: CHAT, clientSeq: 1, action: { type: 'chat/configChanged', config: { tone: 'loud' } } } });
  await at.move({ kind: 'session', session: B });
  expect(at.moved()).toEqual([{ type: 'chat/moved', session: B }]);
  const now = await at.state(CHAT);
  expect(now).not.toHaveProperty('provider');
  expect(now.config).toEqual({ values: { tone: 'loud' } });
  expect(at.sessions.chats?.('b')?.find((row) => row.uri === CHAT)).not.toHaveProperty('provider');
  await at.turn(CHAT, 't2');
  expect(at.starts.two.at(-1)?.settings).toMatchObject({ tone: 'loud' });
});

it('gives a chat of another agent a session of its own agent', async () => {
  const at = await serving();
  await at.session(A, 'one');
  await at.peerChat('two');
  const { session } = await at.move({ kind: 'newSession' });
  const rows = await at.client.handle({ method: 'listSessions', params: { channel: ROOT } }) as { items: { resource: string; provider: string }[] };
  expect(rows.items.find((one) => one.resource === session)?.provider).toBe('two');
  expect(await at.state(CHAT)).not.toHaveProperty('provider');
  expect(at.moved()).toEqual([{ type: 'chat/moved', session }]);
});

it('refuses a move across agents, in VS Code\'s words, while chats with their own agents are off', async () => {
  const at = await serving();
  await at.session(A, 'one');
  await at.session(B, 'two');
  await at.peerChat('two');
  await at.root({ 'multipleChatProviders.enabled': false });
  const refusal = {
    message: 'Chats can only move between sessions of the same agent. Turn on chats with their own agents to move it to a session of another agent.',
    data: { reason: 'differentProvider' },
  };
  await expect(at.move({ kind: 'session', session: B })).rejects.toMatchObject(refusal);
  expect((await at.state(CHAT)).movable ?? false).toBe(false);
  await at.root({ 'multipleChatProviders.enabled': true });
  expect((await at.state(CHAT)).movable).toBe(true);
  expect(at.moved()).toEqual([]);
});
