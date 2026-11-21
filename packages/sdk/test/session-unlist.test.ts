/*
 * An unlist: the row goes, the provider's conversation stays.
 *
 * `disposeSession` asks a backend to delete its own copy, which is right for a
 * session nobody wants back and wrong for one a caller is moving off its
 * catalogue while keeping the transcript - a fleet seat whose next host resumes
 * the same conversation. What is here is that second half: the same disposal
 * with `preserveProviderSession: true`, the id it answers with, and the mark
 * that keeps the next listing from offering the row again because the backend
 * still holds it.
 */

import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileSessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-unlist-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/** A row the backend lists, dated now, so no external-session window hides it. */
const listedRow = (id: string): Listed => {
  const now = new Date().toISOString();
  return { id, title: id, createdAt: now, modifiedAt: now, workingDirectories: [] };
};

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** An echo backend that lists `rows` and records every delete it is asked for. */
const backend = (rows: Listed[], deleted: string[] = []): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    list: async () => rows,
    delete: async (id) => { deleted.push(id); },
  };
};

/** A store holding one session the host ran, as a restart reads it. */
const recorded = (store: SessionStore, id: string, folder: string): SessionStore => {
  store.setProvider(id, 'echo');
  store.setWorkingDirectory?.(id, folder);
  return store;
};

const serving = async (agent: Agent, store?: SessionStore) => {
  const host = createHost({ path: dir, agents: [agent], ...(store === undefined ? {} : { sessions: store }) });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  return { host, client, notes: p.notes };
};

const listing = async (client: Awaited<ReturnType<typeof serving>>['client']): Promise<string[]> => {
  const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string }[];
  };
  return rows.items.map((one) => one.resource);
};

/** Whether the catalogue holds a row for this session, under whichever name the host gave it. */
const holds = (rows: readonly string[], id: string): boolean => rows.some((one) => one.endsWith(':/' + id));

const unlist = (client: Awaited<ReturnType<typeof serving>>['client'], uri: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
  client.handle({ method: 'disposeSession', params: { channel: uri, preserveProviderSession: true, ...extra } });

const refused = async (run: Promise<unknown>): Promise<string> =>
  await run.then(() => { throw new Error('the call was expected to refuse'); }, (error: { message: string }) => error.message);

it('drops the row, keeps the conversation, and never asks the backend to delete it', async () => {
  const deleted: string[] = [];
  const rows: Listed[] = [listedRow('ember')];
  const store = recorded(fileSessions({ dir: join(dir, 'sessions') }), 'ember', dir);
  expect(store.workingDirectory?.('ember')).toBe(dir);
  const { client, notes } = await serving(backend(rows, deleted), store);

  expect(holds(await listing(client), 'ember')).toBe(true);

  const answered = await unlist(client, 'echo:/ember') as Record<string, unknown>;
  await settle();

  // The id a resume is made with, where it ran, and how many chat records went.
  expect(answered).toMatchObject({ provider: 'echo', providerSessionId: 'ember', directory: dir, chatsRemoved: 0 });
  // Not this host's row any more, and not the backend's conversation either.
  expect(holds(await listing(client), 'ember')).toBe(false);
  expect(deleted).toEqual([]);
  expect(store.provider('ember')).toBeUndefined();
  // The watching client is told, through the removal it already knows.
  expect(notes.some((one) => one.method === 'root/sessionRemoved')).toBe(true);
  // The folder the conversation worked in is the caller's to remove, so it is still there.
  expect(existsSync(dir)).toBe(true);
});

it('a disposal without the option still asks the backend to delete its copy', async () => {
  const deleted: string[] = [];
  const rows: Listed[] = [listedRow('ember')];
  const store = recorded(fileSessions({ dir: join(dir, 'sessions') }), 'ember', dir);
  const { client } = await serving(backend(rows, deleted), store);
  await listing(client);

  await client.handle({ method: 'disposeSession', params: { channel: 'echo:/ember' } });
  await settle();

  expect(deleted).toEqual(['ember']);
});

it('stays gone after a restart, though the backend still lists the conversation', async () => {
  const rows: Listed[] = [listedRow('ember')];
  const store = join(dir, 'sessions');

  const first = await serving(backend(rows), recorded(fileSessions({ dir: store }), 'ember', dir));
  await listing(first.client);
  await unlist(first.client, 'echo:/ember');
  first.client.close();
  first.host.close?.();
  await settle();

  // The daemon again on the same folder, with the backend still holding - and
  // still listing - the conversation the unlist kept. External sessions are
  // shown, which is what makes this a test of the mark: with them hidden, a
  // row with no record is dropped by the mode rather than by anything the
  // unlist did.
  const second = await serving(backend(rows), fileSessions({ dir: store }));
  await second.client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { showExternalSessions: 'last30Days' } } },
  });
  expect(holds(await listing(second.client), 'ember')).toBe(false);
  second.client.close();
});

it('refuses a different provider session id before anything is dropped', async () => {
  const deleted: string[] = [];
  const rows: Listed[] = [listedRow('ember')];
  const store = recorded(fileSessions({ dir: join(dir, 'sessions') }), 'ember', dir);
  const { client } = await serving(backend(rows, deleted), store);
  await listing(client);

  const said = await refused(unlist(client, 'echo:/ember', { expectProviderSessionId: 'ash' }));
  expect(said).toContain('expectProviderSessionId');

  // Nothing moved: the row is still listed and the backend was not even asked.
  expect(holds(await listing(client), 'ember')).toBe(true);
  expect(deleted).toEqual([]);
});

it('comes back when a session is made again on the id the unlist answered with', async () => {
  const rows: Listed[] = [listedRow('ember')];
  const store = join(dir, 'sessions');
  const kept = recorded(fileSessions({ dir: store }), 'ember', dir);
  const { client } = await serving(backend(rows), kept);
  await listing(client);

  await unlist(client, 'echo:/ember');
  expect(holds(await listing(client), 'ember')).toBe(false);
  expect(kept.unlisted?.('ember')).toBe(true);

  await client.handle({ method: 'createSession', params: { channel: 'echo:/ember', provider: 'echo', workingDirectories: [`file://${dir}`] } });
  // A session nobody has spoken in is not listed yet, so the mark going is
  // what is asserted here and the listing is what follows the first message.
  expect(kept.unlisted?.('ember')).toBe(false);
  void client.handle({ method: 'createChat', params: { channel: 'echo:/ember', chat: 'ahp-chat:/ember-first', initialMessage: { text: 'back', origin: { kind: 'user' } } } });
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    if (holds(await listing(client), 'ember')) break;
    await settle(2);
  }

  expect(holds(await listing(client), 'ember')).toBe(true);
  client.close();
});

it('refuses a session this host is still running, naming the stop it cannot prove', async () => {
  const { client } = await serving(backend([]));
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/held', provider: 'echo', workingDirectories: [`file://${dir}`] } });

  const said = await refused(unlist(client, 'ahp-session:/held'));
  expect(said).toContain('stop-unproven');
  client.close();
});

it('refuses a turn that is running, naming the chat', async () => {
  // A paced backend: the turn is still being written when the unlist arrives.
  const base = echo({ path: dir, pace: 400 });
  const { client } = await serving({ ...base, list: async () => [] });
  const uri = 'ahp-session:/talker';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [`file://${dir}`] } });
  void client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/talker', initialMessage: { text: 'one two three four', origin: { kind: 'user' } } } }).catch(() => {});
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) { await settle(1); break; }

  const said = await refused(unlist(client, uri));
  expect(said).toContain('session-live');
  client.close();
});
