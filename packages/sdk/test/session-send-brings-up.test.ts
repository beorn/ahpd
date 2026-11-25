import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A backend whose send says when it has brought its session up.
 *
 * `sendMessage` may return a promise. A backend that starts a process for its
 * session settles it once that process holds the session, and rejects it when
 * the process could not be started, so the host brings a provisional session
 * up only when its backend did: one whose first message could not be started
 * fails its creation with the turn's error rather than reading ready with
 * nothing behind it.
 */

const DIR = '/tmp/ahpd-send-brings-up';

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Note = { channel: string; action: Record<string, unknown> };

/** The lifecycle steps the peer was told, in order. */
const told = (p: ReturnType<typeof peer>): string[] => p.notes.flatMap((one) => {
  if (one.method === 'root/sessionAdded') return ['root/sessionAdded'];
  if (one.method !== 'action') return [];
  const { action } = one.params as Note;
  return ['chat/error', 'session/ready', 'session/creationFailed'].includes(String(action.type)) ? [String(action.type)] : [];
});

/**
 * The example backend with its send replaced: `bringUp` decides what each send
 * returns, given the turn the example would run.
 */
function backend(bringUp: (run: () => void) => void | Promise<void>): Agent {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider: 'brings-up',
    displayName: 'Brings-up backend',
    create: (start: Start): Session => {
      const session = base.create(start);
      return {
        ...session,
        sendBringsUp: true,
        sendMessage: (turnId, text, from) => bringUp(() => { void session.sendMessage(turnId, text, from); }),
      };
    },
  };
}

async function opened(agent: Agent) {
  const p = peer();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/brings-up';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'brings-up' } });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
  });
  const lifecycle = async (): Promise<string> => ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { lifecycle: string } };
  }).snapshot.state.lifecycle;
  return { p, lifecycle, client, chatUri };
}

it('fails the creation of a session whose backend rejects its first send, with the backend\'s words, and never says it ready', async () => {
  const { p, lifecycle } = await opened(backend(() => Promise.reject(new Error('claude-agent-acp: claude was not found on PATH /usr/bin'))));
  await settle();

  expect(told(p)).toEqual(['chat/error', 'session/creationFailed', 'root/sessionAdded']);
  const failed = p.notes.map((one) => one.params as Note).find((one) => one.action?.type === 'session/creationFailed');
  expect(failed?.action.error).toMatchObject({ errorType: 'sendFailed', message: 'claude-agent-acp: claude was not found on PATH /usr/bin' });
  expect(await lifecycle()).toBe('failed');
});

it('says a session ready only once its backend\'s send has brought it up', async () => {
  let up: () => void = () => {};
  const { p, lifecycle } = await opened(backend((run) => new Promise<void>((resolve) => { up = () => { run(); resolve(); }; })));
  await settle();

  // Handed, but not yet up: still being created, and announced to nobody.
  expect(told(p)).toEqual([]);
  expect(await lifecycle()).toBe('creating');

  up();
  await settle();
  expect(told(p)).toEqual(['root/sessionAdded', 'session/ready']);
  expect(await lifecycle()).toBe('ready');
});

it('says a session ready for a backend that says its send brings it up but returns nothing', async () => {
  const { p, lifecycle } = await opened(backend((run) => { run(); }));
  await settle();

  expect(told(p)).toEqual(['root/sessionAdded', 'session/ready']);
  expect(await lifecycle()).toBe('ready');
});

/** A turn stopped while its backend is still being started, which then settles as `settles` says. */
async function stoppedWhileStarting(settles: (up: () => void, down: (error: Error) => void) => void) {
  let finish: () => void = () => {};
  const held = await opened(backend(() => new Promise<void>((resolve, reject) => { finish = () => { settles(resolve, reject); }; })));
  await settle();
  await held.client.handle({ method: 'dispatchAction', params: { channel: held.chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 1 } } });
  await settle();
  finish();
  await settle();
  return held;
}

it('says a session ready once its backend is up, though its turn was stopped meanwhile', async () => {
  const { p, lifecycle } = await stoppedWhileStarting((up) => { up(); });

  expect(told(p)).toEqual(['root/sessionAdded', 'session/ready']);
  expect(await lifecycle()).toBe('ready');
});

it('fails the creation of a session whose backend could not start, though its turn was stopped meanwhile', async () => {
  const { p, lifecycle } = await stoppedWhileStarting((_, down) => { down(new Error('it could not be started')); });

  expect(told(p)).toEqual(['session/creationFailed', 'root/sessionAdded']);
  expect(await lifecycle()).toBe('failed');
});
