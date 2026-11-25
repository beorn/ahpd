import { expect, it } from 'vitest';
import { reasoningTimer } from '../src/host/reasoning.js';
import { merger } from '../src/host/deltas.js';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import { WORK } from './support/work.js';

/*
 * AHP 1.1.0's reasoning times: a run opens with `startedAt` and ends with a
 * `chat/reasoning` that has no text and the `duration`, whichever agent ran.
 */

const CHAT = 'ahp-chat:/c';
const timer = () => {
  let at = 0;
  const made = reasoningTimer({ now: () => at, date: () => new Date(Date.UTC(2026, 0, 1) + at) });
  return { say: (action: Record<string, unknown>, channel = CHAT) => made.timed(channel, action), pass: (ms: number) => { at += ms; } };
};
const opens = (id: string, more: Record<string, unknown> = {}) =>
  ({ type: 'chat/responsePart', turnId: 't', part: { id, kind: 'reasoning', content: '', ...more } });

it.each([
  ['text', { type: 'chat/delta', turnId: 't', partId: 'x', content: 'a' }],
  ['another part', { type: 'chat/responsePart', turnId: 't', part: { id: 'x', kind: 'markdown', content: '' } }],
  ['a call', { type: 'chat/toolCallStart', turnId: 't', toolCallId: 'x' }],
  ['the turn\'s end', { type: 'chat/turnComplete', turnId: 't', duration: 1 }],
  ['a stop', { type: 'chat/turnCancelled', turnId: 't', duration: 1 }],
  ['a failure', { type: 'chat/error', turnId: 't', duration: 1 }],
])('ends a run at %s, once', (_, next) => {
  const { say, pass } = timer();
  expect(say(opens('p'))).toEqual([opens('p', { startedAt: '2026-01-01T00:00:00.000Z' })]);
  pass(1200.4);
  const text = { type: 'chat/reasoning', turnId: 't', partId: 'p', content: 'hm' };
  expect(say(text)).toEqual([text]);
  pass(300);
  expect(say(next)).toEqual([
    { type: 'chat/reasoning', turnId: 't', partId: 'p', content: '', startedAt: '2026-01-01T00:00:00.000Z', duration: 1500 },
    next,
  ]);
  expect(say(next)).toEqual([next]);
});

it('ends one run where the next opens, and times each chat apart', () => {
  const { say, pass } = timer();
  say(opens('p'));
  say(opens('w'), 'ahp-chat:/worker');
  pass(5);
  expect(say(opens('q')).map((one) => one.type)).toEqual(['chat/reasoning', 'chat/responsePart']);
  expect(say({ type: 'chat/usage', turnId: 't' })).toHaveLength(1);
  expect(say({ type: 'chat/turnComplete', turnId: 't' }, 'ahp-chat:/worker')).toMatchObject([{ partId: 'w', duration: 5 }, {}]);
});

it('leaves alone a part that arrives whole and one its agent times', () => {
  const { say } = timer();
  const whole = opens('p', { content: 'all of it' });
  expect(say(whole)).toEqual([whole]);
  const own = opens('p', { startedAt: '2020-01-01T00:00:00.000Z' });
  expect(say(own)).toEqual([own]);
  say(opens('q'));
  const ended = { type: 'chat/reasoning', turnId: 't', partId: 'q', content: '', duration: 7 };
  expect(say(ended)).toEqual([ended]);
  expect(say({ type: 'chat/turnComplete', turnId: 't' })).toHaveLength(1);
});

it('keeps the times a merged chunk carries', () => {
  const sent: Record<string, unknown>[] = [];
  const window = merger({ windowMs: 60_000, send: (_channel, action) => { sent.push(action); } });
  window.push(CHAT, { type: 'chat/reasoning', turnId: 't', partId: 'p', content: 'a' }, undefined);
  window.push(CHAT, { type: 'chat/reasoning', turnId: 't', partId: 'p', content: '', startedAt: 'x', duration: 7 }, undefined);
  window.flush();
  expect(sent.at(-1)).toMatchObject({ startedAt: 'x', duration: 7 });
  expect(sent.map((one) => one.content).join('')).toBe('a');
});

it('puts both times on the part a late client reads', async () => {
  let start: Start | undefined;
  const base = echo({ path: WORK });
  const host = createHost({ path: WORK, agents: [{ ...base, create: (given: Start) => { start = given; return base.create(given); } }] });
  try {
    const peer: Peer = { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} };
    const client = host.accept(peer);
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['1.1.0'] } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/s', provider: 'echo' } });
    const session = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/s' } }) as { snapshot: { state: { defaultChat: string } } };
    const emit = (start as Start).emit;
    emit('chat', { type: 'chat/turnStarted', turnId: 't', startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } });
    emit('chat', opens('p'));
    emit('chat', { type: 'chat/reasoning', turnId: 't', partId: 'p', content: 'hm' });
    emit('chat', { type: 'chat/responsePart', turnId: 't', part: { id: 'x', kind: 'markdown', content: 'ok' } });
    const chat = await client.handle({ method: 'subscribe', params: { channel: session.snapshot.state.defaultChat } }) as
      { snapshot: { state: { activeTurn: { responseParts: Record<string, unknown>[] } } } };
    const part = chat.snapshot.state.activeTurn.responseParts[0];
    expect(part).toMatchObject({ kind: 'reasoning', content: 'hm', startedAt: expect.any(String), duration: expect.any(Number) });
  }
  finally { await host.close(); }
});
