/*
 * A session this host did not make is made its own on request.
 *
 * VS Code's window imports one when a person opens a session a CLI made
 * outside the host to continue it: the session keeps its URI and its turns,
 * and stops being external.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3987-L4001
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L2599-L2621
 */
import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import { holds } from '../src/access/users.js';
import { memorySessions } from '../src/sessions/sessions.js';
import type { Bag } from '../src/types/common.js';
import type { Grant, Users } from '../src/types/users.js';
import {
  actions, createHost, defaultChatOf, emit, hello, peer, resetSdk, sdk, serving, settle, showExternal, wrote,
} from './support/host.js';
import { WORK } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;
type Row = { resource: string; _meta?: Record<string, unknown> };

/** A session a backend made outside this host, held both by the backend's listing and by its written record. */
const external = (id: string, frames: Record<string, unknown>[] = []): void => {
  sdk.sessions.push({ sessionId: id, summary: 'Theirs', lastModified: Date.now() - HOUR, cwd: WORK });
  sdk.transcript.push(...frames);
  wrote(id, WORK);
};

/** The sessions a client is listed, as its mode shows them. */
const listed = async (client: Client): Promise<Row[]> =>
  ((await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } })) as { items: Row[] }).items;

/** The state a client is handed for a chat, as the host holds it now. */
const stateOf = async (client: Client, chat: string): Promise<Bag> =>
  ((await client.handle({ method: 'subscribe', params: { channel: chat } })) as { snapshot: { state: Bag } }).snapshot.state;

/** The words of a held chat's turns, oldest first. */
const texts = (state: Bag): string[] =>
  (Array.isArray(state.turns) ? state.turns as Bag[] : []).map((turn) => String((turn.message as Bag | undefined)?.text ?? ''));

/** Every set of turns a peer was handed by `chat/turnsLoaded`, in the order it was told. */
const loaded = (p: ReturnType<typeof peer>, chat: string): Bag[][] =>
  actions(p, chat).filter((one) => one.action.type === 'chat/turnsLoaded')
    .map((one) => (one.action.turns as Bag[] | undefined) ?? []);

/** Wait until `done` answers true, by the clock a case has. */
const until = async (done: () => boolean): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (done()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  if (!done()) throw new Error('the turns the backend holds were never said');
};

/** A host with users where ana and bo may each read and write sessions, and nobody is an administrator. */
const directory = (): Users => {
  const member: Grant[] = ['session:read', 'session:write'];
  const person = (id: string) => ({ id, roles: ['member'], can: (one: Grant) => holds(new Set(member), one) });
  return {
    resource: { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['ahpd://users'], required: false },
    verify: async (token: string) => (token === 'ana' || token === 'bo' ? person(token) : undefined),
    list: async () => [],
    grantsOfRoles: async () => [],
    grantsOfPerson: async () => undefined,
  } as unknown as Users;
};

describe('importing a session', () => {
  it('is adopted, and is no longer external', async () => {
    external('older');
    const store = memorySessions();
    const client = serving(WORK, [], { sessions: store }).accept(peer());
    const ready = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as Bag;
    expect((ready._meta as Bag)['vscode.importSession']).toBe(true);
    await showExternal(client, 'last30Days');
    await settle();
    expect((await listed(client)).find((one) => one.resource === 'ahp-session:/older')?._meta)
      .toEqual({ 'vscode.external': true });

    expect(await client.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/older' } }))
      .toEqual({ session: 'ahp-session:/older' });
    await settle();

    expect(store.external?.('older')).toBeUndefined();
    // The backend is recorded as its provider under the name it is held by, so
    // a later listing does not find it external again.
    expect(store.provider('older')).toBe('claude');
    expect(store.uri?.('older')).toBe('ahp-session:/older');
    expect((await listed(client)).find((one) => one.resource === 'ahp-session:/older')?._meta?.['vscode.external'])
      .toBeUndefined();
  });

  it('reads a loaded session\'s turns again, replacing the ones it holds with the turn written since', async () => {
    external('stale', [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } },
      { type: 'assistant', uuid: 'a1', message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'answer' }] } },
    ]);
    const p = peer();
    const client = serving(WORK, [], { sessions: memorySessions() }).accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const chat = await defaultChatOf(client, 'ahp-session:/stale');
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await settle();
    expect(texts(await stateOf(client, chat))).toEqual(['earlier']);

    sdk.transcript.push({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'later' } });
    expect(await client.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/stale' } }))
      .toEqual({ session: 'ahp-session:/stale' });
    await settle();

    const state = await stateOf(client, chat);
    expect(texts(state)).toEqual(['earlier', 'later']);
    // The draft takes the model the backend restored, which the turn answered
    // on before the one written since.
    expect((state.draft as Bag).model).toEqual({ id: 'claude-sonnet-5' });
    // Replaced rather than merged, as the reference host replaces turns whose
    // ids were made here with the backend's own.
    expect(loaded(p, chat).map((turns) => turns.map((turn) => String((turn.message as Bag).text))))
      .toEqual([['earlier', 'later']]);
  });

  it('waits for a running turn before replacing the turns it read', async () => {
    external('busy', [{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } }]);
    const p = peer();
    const client = serving(WORK, [], { sessions: memorySessions() }).accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const chat = await defaultChatOf(client, 'ahp-session:/busy');
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await settle();
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: chat,
        action: { type: 'chat/turnStarted', turnId: 'running', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'and now?' } },
      },
    });
    await settle(8);
    expect((await stateOf(client, chat)).activeTurn).toBeDefined();

    sdk.transcript.push({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'later' } });
    expect(await client.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/busy' } }))
      .toEqual({ session: 'ahp-session:/busy' });
    // Longer than the poll: the replacement is still waiting for the turn.
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(loaded(p, chat)).toEqual([]);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await settle(8);
    await until(() => loaded(p, chat).length > 0);
    expect(loaded(p, chat).at(-1)?.map((turn) => String((turn.message as Bag).text)))
      .toEqual(['earlier', 'later']);
  });

  it('refuses a session the host does not know', async () => {
    const client = serving(WORK).accept(peer());
    await client.handle(hello(['0.9.0']));
    const refused = await client.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/nobody' } })
      .then(() => undefined, (error: { code: number; message: string }) => error);
    expect(refused?.code).toBe(AhpErrorCodes.SessionNotFound);
    expect(refused?.message).toBe('Session not found: ahp-session:/nobody');
  });

  /*
   * The rule a person's first turn follows: a member may drive a session that
   * is not theirs, so the first person whose action adopts an external session
   * owns it and a later one neither takes it over nor is refused.
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/chatContributions/externalSessionAdoption/externalSessionAdoptionContribution.ts#L25-L30
   */
  it('is adopted by the first person to import it, and not taken over by a later one', async () => {
    external('older', [{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } }]);
    const store = memorySessions();
    const host = serving(WORK, [], { sessions: store, users: directory() });
    const ana = host.accept(peer());
    const bo = host.accept(peer());
    const signIn = async (client: Client, token: string): Promise<void> => {
      await client.handle(hello(['0.9.0'], { clientId: token, initialSubscriptions: ['ahp-root://'] }));
      await client.handle({ method: 'authenticate', params: { channel: 'ahp-root://', resource: 'ahpd://users', token } });
    };
    await signIn(ana, 'ana');
    await signIn(bo, 'bo');
    // Nobody owns it yet, so a member importing it claims it.
    expect(await bo.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/older' } }))
      .toEqual({ session: 'ahp-session:/older' });
    expect(store.owner('older')).toBe('user:bo');

    // A later import is answered, as a turn on somebody else's session is, and
    // the owner it already has stands.
    expect(await ana.handle({ method: 'vscode/importSession', params: { session: 'ahp-session:/older' } }))
      .toEqual({ session: 'ahp-session:/older' });
    expect(store.owner('older')).toBe('user:bo');
  });
});
