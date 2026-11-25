/*
 * A running call a provider can move to the background.
 *
 * The provider offers the call and the host writes what a client reads of it:
 * `ahpd.backgroundToolCall` on the running call while the offer stands, and
 * `ahpd.backgroundWork`, the row's id, once its work runs in the background.
 * `x-ahpd/backgroundToolCall` is how a person moves it. Here the backend holds
 * one call running until the case completes it, so every step can be read on
 * the wire between the two.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import { ROOT } from '../src/host.js';
import { Status } from '../src/sessions/catalog.js';
import type { Agent, Listed, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Host } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';
import { can, directory } from './users-gate-helpers.js';

const { createHost } = await import('../src/host.js');

/** Every frame the host put on the wire, in order. */
const wire: { method: string; params: Record<string, unknown> }[] = [];

function peer(): Peer {
  return {
    send: () => {},
    notify: (method, params) => { wire.push({ method, params: params as Record<string, unknown> }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/** Every action dispatched on one channel, in order. */
const on = (channel: string): Bag[] => wire
  .filter((one) => one.method === 'action' && one.params.channel === channel)
  .map((one) => one.params.action as Bag);

const until = async (check: () => boolean): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  throw new Error('waited too long');
};

/** The call every turn makes. */
const CALL = 'tc-1';

/** What a case does to the backend's one call. */
interface Backend {
  /** The seam the host handed on `Start`. */
  start: () => Start;
  /** Complete the call, with the `_meta` the backend writes on its completion, if any. */
  complete: (meta?: Bag) => void;
}

/**
 * A backend whose turn starts one running call and holds it.
 *
 * The call carries a `_meta` key of the backend's own, which the host must
 * keep through every action it writes.
 */
function holding(): { agent: Agent; backend: Backend } {
  let started: Start | undefined;
  let complete: ((meta?: Bag) => void) | undefined;
  const agent: Agent = {
    provider: 'fake',
    displayName: 'Fake',
    schema: () => ({ type: 'object', properties: {} }),
    defaults: () => ({}),
    list: async (): Promise<Listed[]> => [],
    create: (start: Start): Session => {
      started = start;
      const turns: Bag[] = [];
      let active: Bag | undefined;
      return {
        uri: start.uri,
        chatUri: start.chatUri,
        models: () => [],
        agentId: () => start.uri,
        customizations: () => [],
        allTurns: () => turns,
        activity: () => (active ? 'Working' : undefined),
        status: () => (active ? Status.InProgress : Status.Idle),
        title: () => 'Held',
        modifiedAt: () => new Date().toISOString(),
        workingDirectories: () => [],
        settings: () => ({}),
        sessionState: () => ({
          provider: 'fake', title: 'Held', status: active ? Status.InProgress : Status.Idle,
          lifecycle: 'ready', defaultChat: start.chatUri, chats: [{ resource: start.chatUri, title: 'Held' }],
          workingDirectories: [], customizations: [], config: { schema: start.schema(), values: {} },
        }),
        chatState: () => ({
          resource: start.chatUri, title: 'Held', status: active ? Status.InProgress : Status.Idle,
          modifiedAt: new Date().toISOString(), turns,
          ...(active ? { activeTurn: active } : {}), queuedMessages: [], interactivity: 'full',
        }),
        sendMessage: (turnId, text) => {
          const startedAt = new Date().toISOString();
          const turn: Bag = { id: turnId, startedAt, message: { text, origin: { kind: 'user' } }, responseParts: [] };
          active = turn;
          start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: turn.message });
          const call: Bag = {
            toolCallId: CALL, toolName: 'bash', displayName: 'Run command', status: 'running',
            confirmed: 'not-needed', invocationMessage: 'Run command', content: [], _meta: { 'fake.own': 1 },
          };
          (turn.responseParts as Bag[]).push({ kind: 'toolCall', toolCall: call });
          start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: CALL, toolName: 'bash', displayName: 'Run command', _meta: { 'fake.own': 1 } });
          start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId: CALL, invocationMessage: 'Run command', confirmed: 'not-needed' });
          complete = (meta) => {
            const result = { success: true, pastTenseMessage: 'Ran command', content: [{ type: 'text', text: 'done' }] };
            Object.assign(call, { status: 'completed', ...result });
            start.emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId: CALL, result, ...(meta === undefined ? {} : { _meta: meta }) });
            turns.push(turn);
            active = undefined;
            start.emit('chat', { type: 'chat/turnComplete', turnId, duration: 1 });
          };
        },
        changeModel: () => {},
        changeAgent: () => {},
        abort: () => {},
        setDraft: () => {},
        confirm: () => false,
        answer: () => false,
        setCustomizationEnabled: async () => false,
        startMcpServer: async () => false,
        stopMcpServer: async () => false,
        close: () => {},
      };
    },
  };
  return {
    agent,
    backend: {
      start: () => started as Start,
      complete: (meta) => { complete?.(meta); },
    },
  };
}

const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

type Asker = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }): Asker =>
  async (method, params = {}) => await client.handle({ method, params });

/** A host with one session of the holding backend, its turn started and its call running. */
async function running(users = false) {
  wire.length = 0;
  const { agent, backend } = holding();
  const host = createHost({ path: '/', agents: [agent], ...(users ? { users: directory({}) } : {}) });
  opened.push(host);
  const client = users
    ? host.accept(peer(), { id: 'o', roles: ['r'], can: can(['session:read', 'session:write']) })
    : host.accept(peer());
  const ask = asking(client);
  await ask('initialize', { channel: ROOT, clientId: 'moves', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] });
  await ask('createSession', { channel: 'ahp-session:/held', provider: 'fake' });
  const session = await ask('subscribe', { channel: 'ahp-session:/held' }) as { snapshot: { state: { defaultChat: string } } };
  const chat = session.snapshot.state.defaultChat;
  await ask('subscribe', { channel: chat });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run it' } } },
  });
  await until(() => on(chat).some((one) => one.type === 'chat/toolCallReady'));
  return { host, ask, chat, backend, seam: () => backend.start().movableCalls as NonNullable<Start['movableCalls']> };
}

/** The `_meta` each content change of the call carried, in order. */
const metas = (chat: string): unknown[] => on(chat)
  .filter((one) => one.type === 'chat/toolCallContentChanged' && one.toolCallId === CALL)
  .map((one) => one._meta);

/** The call's completion on the wire. */
const completion = async (chat: string): Promise<Bag> => {
  await until(() => on(chat).some((one) => one.type === 'chat/toolCallComplete'));
  return on(chat).find((one) => one.type === 'chat/toolCallComplete') as Bag;
};

describe('a call a provider offers to move', () => {
  it('carries the flag while the offer stands, beside its own keys, and loses it when withdrawn', async () => {
    const { chat, seam } = await running();
    seam().offer(chat, CALL, async () => true);
    seam().withdraw(chat, CALL);
    expect(metas(chat)).toEqual([
      { 'fake.own': 1, 'ahpd.backgroundToolCall': true },
      { 'fake.own': 1 },
    ]);
  });

  it('says a second offer of the same call nothing new', async () => {
    const { chat, seam } = await running();
    seam().offer(chat, CALL, async () => true);
    seam().offer(chat, CALL, async () => false);
    expect(metas(chat)).toHaveLength(1);
  });

  it('completes without the flag where it never moved, even on a completion with no _meta', async () => {
    const { chat, seam, backend } = await running();
    seam().offer(chat, CALL, async () => true);
    backend.complete();
    expect((await completion(chat))._meta).toEqual({ 'fake.own': 1 });
  });

  it('names its row on the running call and on the completion once moved, and keeps the backend\'s keys', async () => {
    const { chat, seam, backend } = await running();
    seam().offer(chat, CALL, async () => true);
    seam().moved(chat, CALL, 'shell:7');
    expect(metas(chat).at(-1)).toEqual({ 'fake.own': 1, 'ahpd.backgroundWork': 'shell:7' });
    backend.complete({ 'fake.done': true });
    expect((await completion(chat))._meta).toEqual({ 'fake.done': true, 'ahpd.backgroundWork': 'shell:7' });
  });

  it('reads back the completed call with its row and no flag', async () => {
    const { ask, chat, seam, backend } = await running();
    seam().offer(chat, CALL, async () => true);
    seam().moved(chat, CALL, 'shell:7');
    backend.complete();
    await completion(chat);
    const late = await ask('subscribe', { channel: chat }) as { snapshot: { state: { turns: Bag[] } } };
    const part = (late.snapshot.state.turns[0]?.responseParts as Bag[]).find((one) => one.kind === 'toolCall') as Bag;
    expect((part.toolCall as Bag)._meta).toEqual({ 'fake.own': 1, 'ahpd.backgroundWork': 'shell:7' });
  });
});

describe('x-ahpd/backgroundToolCall', () => {
  it('calls the offered move once and answers what it answered', async () => {
    const { ask, chat, seam } = await running();
    let moves = 0;
    seam().offer(chat, CALL, async () => {
      moves += 1;
      seam().moved(chat, CALL, 'shell:7');
      return true;
    });
    expect(await ask('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).toEqual({ backgrounded: true });
    expect(moves).toBe(1);
    // The move took the offer back: a second press has nothing to move.
    expect(await ask('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).toEqual({ backgrounded: false });
  });

  it('answers false for a move that did not happen, an unknown call and an unknown chat', async () => {
    const { ask, chat, seam } = await running();
    seam().offer(chat, CALL, async () => false);
    expect(await ask('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).toEqual({ backgrounded: false });
    expect(await ask('x-ahpd/backgroundToolCall', { chat, toolCallId: 'tc-none' })).toEqual({ backgrounded: false });
    expect(await ask('x-ahpd/backgroundToolCall', { chat: 'ahp-chat:/nobody', toolCallId: CALL })).toEqual({ backgrounded: false });
  });

  it('answers false once the call has completed', async () => {
    const { ask, chat, seam, backend } = await running();
    seam().offer(chat, CALL, async () => true);
    backend.complete();
    await completion(chat);
    expect(await ask('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).toEqual({ backgrounded: false });
  });

  it('refuses an empty call id and a URI that is not a chat', async () => {
    const { ask, chat } = await running();
    await expect(ask('x-ahpd/backgroundToolCall', { chat, toolCallId: ' ' })).rejects.toThrow(/toolCallId must be a non-empty string/u);
    await expect(ask('x-ahpd/backgroundToolCall', { chat: 'ahp-session:/held', toolCallId: CALL })).rejects.toThrow(/chat must be an Agent Host chat URI/u);
  });

  it('asks for chat:send, the grant of a steering message, and not chat:cancel', async () => {
    const { host, chat, seam } = await running(true);
    let moves = 0;
    seam().offer(chat, CALL, async () => { moves += 1; return true; });
    const as = async (id: string, granted: Parameters<typeof can>[0]) => {
      const one = host.accept(peer(), { id, roles: ['r'], can: can(granted) });
      await asking(one)('initialize', { channel: ROOT, clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] });
      return asking(one);
    };
    const cancels = await as('c', ['session:read', 'chat:cancel']);
    await expect(cancels('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).rejects.toMatchObject({ message: 'c may not chat:send here' });
    expect(moves).toBe(0);
    const sends = await as('s', ['session:read', 'chat:send']);
    expect(await sends('x-ahpd/backgroundToolCall', { chat, toolCallId: CALL })).toEqual({ backgrounded: true });
    expect(moves).toBe(1);
  });
});
