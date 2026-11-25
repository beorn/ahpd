import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A session that holds one chat moves under another, as VS Code's window
 * moves one by drag and drop: `vscode/moveSession`, and the `vscode.movable`
 * flag that says a session can.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L8261-L8297
 */

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const ROOT = 'ahp-root://';
const A = 'ahp-session:/a';
const B = 'ahp-session:/b';

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

const serving = async (moves = true) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-move-')));
  made.push(dir);
  const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 0 })] });
  hosts.push(host);
  const client = host.accept(peer());
  const hello = await client.handle({ method: 'initialize', params: { clientId: 'move', protocolVersions: ['0.9.0'] } }) as { _meta?: Record<string, unknown> };
  const setMoves = (on: boolean) => client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { 'chatMoves.enabled': on } } },
  });
  if (moves) await setMoves(true);
  const stateOf = async (channel: string) => (await client.handle({ method: 'subscribe', params: { channel } }) as {
    snapshot: { state: { defaultChat: string; chats: { resource: string }[]; _meta?: Record<string, unknown>; turns?: { id: string }[] } };
  }).snapshot.state;
  /** A session with one finished turn in its default chat. */
  const spoken = async (uri: string): Promise<string> => {
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    const { defaultChat } = await stateOf(uri);
    await client.handle({
      method: 'dispatchAction',
      params: { channel: defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: `t-${uri}`, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until && ((await stateOf(defaultChat)).turns ?? []).length === 0;) await new Promise((r) => { setTimeout(r, 10); });
    return defaultChat;
  };
  const move = (params: Record<string, unknown>) => client.handle({ method: 'vscode/moveSession', params });
  /** A session's `_meta` once it says what the test waits for. */
  const metaUntil = async (uri: string, done: (meta: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    let meta: Record<string, unknown> = {};
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      meta = (await stateOf(uri))._meta ?? {};
      if (done(meta)) return meta;
      await new Promise((r) => { setTimeout(r, 10); });
    }
    return meta;
  };
  return { client, hello, setMoves, stateOf, spoken, move, metaUntil };
};

describe('a session that moves under another', () => {
  it('is advertised, and says it can move while moving chats is on and it holds one chat', async () => {
    const { client, hello, setMoves, spoken, metaUntil } = await serving();
    expect(hello._meta?.['vscode.sessionMove']).toBe(true);
    await spoken(A);
    expect((await metaUntil(A, (meta) => meta['vscode.movable'] === true))['vscode.movable']).toBe(true);
    await setMoves(false);
    expect((await metaUntil(A, (meta) => meta['vscode.movable'] === undefined))['vscode.movable']).toBeUndefined();
    await setMoves(true);
    await metaUntil(A, (meta) => meta['vscode.movable'] === true);
    await client.handle({ method: 'createChat', params: { channel: A, chat: 'ahp-chat:/a-second' } });
    expect((await metaUntil(A, (meta) => meta['vscode.movable'] === undefined))['vscode.movable']).toBeUndefined();
  });

  it('moves its chat, with its turns, under the destination, and ends', async () => {
    const { client, stateOf, spoken, move } = await serving();
    const chat = await spoken(A);
    const theirs = await spoken(B);
    expect(await move({ session: A, destination: B, after: theirs })).toEqual({ session: B });
    const b = await stateOf(B);
    expect(b.chats.map((one) => one.resource)).toEqual([theirs, chat]);
    // The destination's default chat is still its own.
    expect(b.defaultChat).toBe(theirs);
    expect(((await stateOf(chat)).turns ?? []).map((one) => one.id)).toEqual([`t-${A}`]);
    const listed = await client.handle({ method: 'listSessions', params: {} }) as { items: { resource: string }[] };
    expect(listed.items.map((one) => one.resource)).not.toContain(A);
    expect(listed.items.map((one) => one.resource)).toContain(B);
  });

  it('places the chat first for a null anchor', async () => {
    const { stateOf, spoken, move } = await serving();
    const chat = await spoken(A);
    const theirs = await spoken(B);
    await move({ session: A, destination: B, after: null });
    expect((await stateOf(B)).chats.map((one) => one.resource)).toEqual([chat, theirs]);
  });

  it('refuses in VS Code\'s reasons and words', async () => {
    const { client, setMoves, spoken, move } = await serving();
    await spoken(A);
    await spoken(B);
    await expect(move({ session: A, destination: A, after: null }))
      .rejects.toMatchObject({ code: -32602, message: 'A session can\'t move under itself.', data: { reason: 'destinationNotFound' } });
    await client.handle({ method: 'createChat', params: { channel: A, chat: 'ahp-chat:/a-second' } });
    await expect(move({ session: A, destination: B, after: null }))
      .rejects.toMatchObject({ code: -32602, data: { reason: 'notMovable' } });
    await setMoves(false);
    await expect(move({ session: B, destination: A, after: null }))
      .rejects.toMatchObject({ code: -32602, message: 'Moving chats is not enabled.', data: { reason: 'disabled' } });
  });
});
