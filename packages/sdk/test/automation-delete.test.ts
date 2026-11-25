import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryAutomations } from '../src/automations/automations.js';
import { createHost, ROOT } from '../src/host.js';
import { idOf } from '../src/sessions/catalog.js';
import { memorySessions } from '../src/sessions/sessions.js';
import {
  defaultChatOf, echo, firstMessage, hello, peer, settle,
} from './support/host.js';
import { directory } from './users-gate-helpers.js';
import type { Bag } from '../src/types/common.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * An automation deleted with the sessions its runs made, as VS Code's window
 * asks its host to delete one.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4003-L4031
 */

const ONE = 'ahp-automation:/triage';
const TWO = 'ahp-automation:/other';
const RUN_ONE = 'ahp-session:/run-one';
const RUN_TWO = 'ahp-session:/run-two';
const LEGACY = 'ahp-session:/legacy';
const AUTOMATIONS = 'ahp-automations://';

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One automation whose runs start an echo session. */
const definition = (over: Bag = {}): Bag => ({
  title: 'Triage a failed turn',
  enabled: true,
  message: { text: 'Look at the failure' },
  session: { provider: 'echo' },
  ...over,
});

/** A host with an automation store and a session store, and one client joined. */
async function joined(store = memoryAutomations()) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-'));
  made.push(dir);
  const sessions = memorySessions();
  const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 0 })], automations: store, sessions });
  hosts.push(host);
  const client = host.accept(peer());
  const answer = await client.handle(hello(['0.9.0'])) as { _meta?: Record<string, unknown> };
  return { client, store, sessions, answer };
}

/** The record the host advertises to a person who signs in. */
const USERS_RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.com'],
  required: false,
};

/** A directory of people, each holding the grants it names. */
const users = (tokens: Record<string, Grant[]>): Users => ({ ...directory(tokens), resource: USERS_RECORD });

/** What a person needs to delete an automation and a session a client remembers. */
const REMOVER: Grant[] = ['automation:remove', 'session:create', 'session:list', 'session:read', 'session:write'];

/**
 * A host with people in it, and a signed-in client for each token, sharing one
 * automation store and one session store.
 */
async function servingUsers(tokens: Record<string, Grant[]>, store = memoryAutomations()) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-'));
  made.push(dir);
  const sessions = memorySessions();
  const host = createHost({
    path: dir, agents: [echo({ path: dir, pace: 0 })], users: users(tokens), automations: store, sessions,
  });
  hosts.push(host);
  const clients: Record<string, Client> = {};
  for (const token of Object.keys(tokens)) {
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0'], { clientId: token }));
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: USERS_RECORD.resource, token } });
    clients[token] = client;
  }
  return { host, clients, store, sessions };
}

/** A session open on this host, announced by a first message so a listing holds it. */
async function live(client: Client, uri: string): Promise<void> {
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await firstMessage(client, await defaultChatOf(client, uri));
  await settle();
}

/** The sessions a listing answers with. */
const listed = async (client: Client): Promise<string[]> => {
  const answer = await client.handle({ method: 'listSessions', params: {} }) as { items: { resource: string }[] };
  return answer.items.map((one) => one.resource);
};

/** Record that an automation's run made a session. */
const began = (sessions: ReturnType<typeof memorySessions>, uri: string, automation: string): void => {
  sessions.setAutomationOrigin?.(idOf(uri), { kind: 'automation', automation, run: 'ahp-automation-run:/one' });
};

const deleteOne = (client: Client, params: Record<string, unknown>): Promise<unknown> =>
  client.handle({ method: 'vscode/deleteAutomation', params: { automation: ONE, ...params } });

describe('deleting an automation', () => {
  it('deletes the sessions its runs made, and answers them, when asked for the history', async () => {
    const { client, store, sessions } = await joined();
    store.create(ONE, definition());
    store.create(TWO, definition());
    await live(client, RUN_ONE);
    await live(client, RUN_TWO);
    const kept = 'ahp-session:/kept';
    await live(client, kept);
    began(sessions, RUN_ONE, ONE);
    began(sessions, RUN_TWO, ONE);
    began(sessions, kept, TWO);

    const answered = await deleteOne(client, { deleteHistory: true, requestId: 'r' });

    expect([...(answered as string[])].sort()).toEqual([RUN_ONE, RUN_TWO].sort());
    expect(store.get(ONE)).toBeUndefined();
    // The other automation's session is not this one's to delete.
    const still = await listed(client);
    expect(still).toContain(kept);
    expect(still).not.toContain(RUN_ONE);
    expect(still).not.toContain(RUN_TWO);
  });

  it('keeps the run sessions without deleteHistory', async () => {
    const { client, store, sessions } = await joined();
    store.create(ONE, definition());
    await live(client, RUN_ONE);
    began(sessions, RUN_ONE, ONE);

    expect(await deleteOne(client, { deleteHistory: false })).toEqual([]);
    expect(store.get(ONE)).toBeUndefined();
    expect(await listed(client)).toContain(RUN_ONE);
  });

  it('keeps the run sessions when the catalogue action removes it', async () => {
    const { client, store, sessions } = await joined();
    store.create(ONE, definition());
    await live(client, RUN_ONE);
    began(sessions, RUN_ONE, ONE);

    await client.handle({
      method: 'dispatchAction',
      params: { channel: AUTOMATIONS, action: { type: 'automation/removed', resource: ONE } },
    });
    await settle();

    expect(store.get(ONE)).toBeUndefined();
    expect(await listed(client)).toContain(RUN_ONE);
  });

  it('deletes a session the client remembers under legacySessions', async () => {
    const { client, store } = await joined();
    store.create(ONE, definition());
    await live(client, LEGACY);

    expect(await deleteOne(client, { deleteHistory: true, legacySessions: [LEGACY] })).toEqual([LEGACY]);
    expect(await listed(client)).not.toContain(LEGACY);
  });

  it('deletes no session of a chat automation', async () => {
    const { client, store, sessions } = await joined();
    store.create(ONE, definition({ target: { kind: 'chat', chat: 'ahp-chat:/one', session: RUN_ONE } }));
    await live(client, RUN_ONE);
    await live(client, LEGACY);
    began(sessions, RUN_ONE, ONE);

    expect(await deleteOne(client, { deleteHistory: true, legacySessions: [LEGACY] })).toEqual([]);
    expect(await listed(client)).toEqual(expect.arrayContaining([RUN_ONE, LEGACY]));
  });

  it('answers nothing for an automation it does not hold', async () => {
    const { client, store } = await joined();
    expect(await deleteOne(client, { deleteHistory: true })).toEqual([]);
    expect(store.list()).toEqual([]);
  });

  it('refuses an automation with a run that has not ended', async () => {
    const { client, store } = await joined();
    store.create(ONE, definition());
    await store.run(ONE, { kind: 'manual' }, async () => RUN_ONE);
    await settle();

    await expect(deleteOne(client, { deleteHistory: true }))
      .rejects.toThrow('Automation has an active or recovering run and cannot be removed');
    expect(store.get(ONE)).toBeDefined();
  });

  it('refuses a URI that is not one automation resource', async () => {
    const { client } = await joined();
    for (const automation of ['ahp-session:/one', 'ahp-automation:', 'ahp-automation:/one?x=1', 'ahp-automation://a/one', 'not a uri']) {
      await expect(deleteOne(client, { automation, deleteHistory: true }))
        .rejects.toThrow('automation must be an ahp-automation URI with a path and no authority, query or fragment');
    }
  });

  it('refuses legacySessions without deleteHistory, and a chat among them', async () => {
    const { client } = await joined();
    await expect(deleteOne(client, { legacySessions: [LEGACY] }))
      .rejects.toThrow('legacySessions may be given only with deleteHistory');
    await expect(deleteOne(client, { deleteHistory: true, legacySessions: ['ahp-chat:/one'] }))
      .rejects.toThrow('legacySessions must name session URIs: ahp-chat:/one');
    await expect(deleteOne(client, { deleteHistory: true, legacySessions: 'ahp-session:/one' }))
      .rejects.toThrow('legacySessions must be an array of session URIs');
    await expect(deleteOne(client, { deleteHistory: 'yes' }))
      .rejects.toThrow('deleteHistory must be a boolean');
  });

  it('answers a repeat from the receipt until it is acknowledged', async () => {
    const { client, store, sessions } = await joined();
    store.create(ONE, definition());
    await live(client, RUN_ONE);
    began(sessions, RUN_ONE, ONE);

    expect(await deleteOne(client, { deleteHistory: true, requestId: 'r' })).toEqual([RUN_ONE]);
    expect(store.receiptOf?.('r')?.sessions).toEqual([RUN_ONE]);

    // The automation is gone, so only the receipt can answer this.
    expect(await deleteOne(client, { deleteHistory: true, requestId: 'r' })).toEqual([RUN_ONE]);

    await client.handle({ method: 'vscode/acknowledgeAutomationDeletion', params: { requestId: 'r' } });
    expect(store.receiptOf?.('r')).toBeUndefined();
    // Dropped, so the same request is a fresh one for an automation nobody has.
    expect(await deleteOne(client, { deleteHistory: true, requestId: 'r' })).toEqual([]);
  });

  it('joins a second request to the deletion running, and refuses one that keeps the history', async () => {
    const { client, store, sessions } = await joined();
    await live(client, RUN_ONE);
    await live(client, RUN_TWO);
    began(sessions, RUN_ONE, ONE);
    began(sessions, RUN_TWO, ONE);
    store.beginDeletion?.(ONE, [RUN_ONE, RUN_TWO], 'a');

    await expect(deleteOne(client, { deleteHistory: false }))
      .rejects.toThrow('Automation deletion is already in progress');

    const first = deleteOne(client, { deleteHistory: true, requestId: 'a' });
    const second = deleteOne(client, { deleteHistory: true, requestId: 'b' });
    const expected = [RUN_ONE, RUN_TWO].sort();
    expect([...(await first) as string[]].sort()).toEqual(expected);
    expect([...(await second) as string[]].sort()).toEqual(expected);
    // Both requests are answered with what the one deletion deleted.
    expect(store.receiptOf?.('a')?.sessions.slice().sort()).toEqual(expected);
    expect(store.receiptOf?.('b')?.sessions.slice().sort()).toEqual(expected);
  });

  it('finishes a deletion in progress when the host starts again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-'));
    made.push(dir);
    const sessions = memorySessions();
    const agent = echo({ path: dir, pace: 0 });
    const before = createHost({ path: dir, agents: [agent], automations: memoryAutomations(), sessions });
    const client = before.accept(peer());
    await client.handle(hello(['0.9.0']));
    await live(client, RUN_ONE);
    await before.close();

    // What the server's automation file holds after the first host removed the
    // definition and stopped before its sessions went.
    const store = memoryAutomations({
      deletions: [{ automation: ONE, sessions: [RUN_ONE], requestIds: ['r'] }],
    });
    const after = createHost({ path: dir, agents: [agent], automations: store, sessions });
    hosts.push(after);
    const again = after.accept(peer());
    await again.handle(hello(['0.9.0']));
    for (let i = 0; i < 200 && store.receiptOf?.('r') === undefined; i++) {
      await new Promise((done) => { setTimeout(done, 5); });
    }

    expect(store.receiptOf?.('r')?.sessions).toEqual([RUN_ONE]);
    expect(await listed(again)).not.toContain(RUN_ONE);
  });

  it("refuses another person's session under legacySessions, and deletes nothing", async () => {
    const { clients, store } = await servingUsers({ ana: REMOVER, bob: REMOVER });
    store.create(ONE, definition());
    await live(clients.ana!, LEGACY);

    await expect(deleteOne(clients.bob!, { deleteHistory: true, legacySessions: [LEGACY] }))
      .rejects.toThrow("Only the session's owner can delete it.");

    // Refused whole, before the automation went.
    expect(store.get(ONE)).toBeDefined();
    expect(await listed(clients.ana!)).toContain(LEGACY);
  });

  it("deletes the caller's own session named under legacySessions", async () => {
    const { clients, store } = await servingUsers({ bob: REMOVER });
    store.create(ONE, definition());
    await live(clients.bob!, LEGACY);

    expect(await deleteOne(clients.bob!, { deleteHistory: true, legacySessions: [LEGACY] })).toEqual([LEGACY]);

    expect(store.get(ONE)).toBeUndefined();
    expect(await listed(clients.bob!)).not.toContain(LEGACY);
  });

  it('finishes a deletion in progress as the requester it kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-'));
    made.push(dir);
    const sessions = memorySessions();
    const agent = echo({ path: dir, pace: 0 });
    const before = createHost({ path: dir, agents: [agent], users: users({ bob: REMOVER }), automations: memoryAutomations(), sessions });
    const client = before.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: USERS_RECORD.resource, token: 'bob' } });
    await live(client, RUN_ONE);
    await before.close();

    // What the automation file holds after the daemon removed the definition
    // and stopped before its sessions went, with the person who asked.
    const store = memoryAutomations({
      deletions: [{ automation: ONE, sessions: [RUN_ONE], requestIds: ['r'], requester: 'user:bob' }],
    });
    const after = createHost({ path: dir, agents: [agent], users: users({ bob: REMOVER }), automations: store, sessions });
    hosts.push(after);
    const again = after.accept(peer());
    await again.handle(hello(['0.9.0']));
    await again.handle({ method: 'authenticate', params: { channel: ROOT, resource: USERS_RECORD.resource, token: 'bob' } });
    for (let i = 0; i < 200 && store.receiptOf?.('r') === undefined; i++) {
      await new Promise((done) => { setTimeout(done, 5); });
    }

    // The resumed deletion passed the requester it kept, so the session went.
    expect(store.receiptOf?.('r')?.sessions).toEqual([RUN_ONE]);
    expect(await listed(again)).not.toContain(RUN_ONE);
  });

  it('advertises the history flags only where the host has automations', async () => {
    const { answer } = await joined();
    expect(answer._meta?.['vscode.automationHistory']).toBe(true);
    expect(answer._meta?.['vscode.automationHistoryReceipts']).toBe(true);
    expect(answer._meta?.['vscode.automationHistoryDeletionState']).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'ahpd-delete-'));
    made.push(dir);
    const bare = createHost({ path: dir, agents: [echo({ path: dir })] });
    hosts.push(bare);
    const plain = await bare.accept(peer()).handle(hello(['0.9.0'])) as { _meta?: Record<string, unknown> };
    expect('vscode.automationHistory' in (plain._meta ?? {})).toBe(false);
  });
});
