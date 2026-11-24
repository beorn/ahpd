import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * A turn the ACP server starts itself (#38159).
 *
 * An agent can work with no prompt asking it to: a scheduled wakeup, a
 * notification, words typed into its own terminal. ACP has no message for such
 * a turn, so its updates arrived outside every turn and were dropped without a
 * word, and a client read an agent at work as idle. A server marks them with
 * `_meta['ahpd/agentTurn']`; the bridge opens a turn whose message is the
 * agent's own, ends it as the mark says or as abandoned when the server goes
 * away first, and counts and logs any update that still arrives outside a turn.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

type Note = { channel: string; action: Record<string, unknown> };

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
}

const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  if (check()) return;
  throw new Error(`still waiting after ${ms} ms`);
};

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/** A client with one ACP session whose first turn is `text`, and the lines the bridge logged. */
async function afterTurn(text: string, then?: string) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-own-'));
  const logged: { line: string; level: string | undefined }[] = [];
  const host = createHost({
    path,
    agents: [acpAgent({
      command: process.execPath,
      args: [FIXTURE],
      provider: 'acp',
      log: (line: string, level?: string) => { logged.push({ line, level }); },
    })],
    users: anyone(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/own';
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } },
    },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'acp', workingDirectories: [uriOf(path)] } });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } },
    },
  });
  // A second prompt handed at once, which waits behind the first.
  if (then !== undefined) {
    void client.handle({
      method: 'dispatchAction',
      params: {
        channel: chatUri,
        action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: then, origin: { kind: 'user' } } },
      },
    });
  }
  // A turn a later one took the place of ends in no client's state, so the last prompt's end is the one waited for.
  const last = then === undefined ? 't1' : 't2';
  await until(() => actions(p, chatUri).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === last));
  return { p, client, chatUri, logged, uri };
}

const of = (notes: Note[], turnId: string): Note[] => notes.filter((e) => e.action.turnId === turnId);

it('opens a turn the server started itself as the agent\'s own, shows its words in it, and ends it as marked', async () => {
  const { p, chatUri } = await afterTurn('selfturn');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/turnComplete'));
  const own = of(actions(p, chatUri), 'own-1');
  const started = own.find((e) => e.action.type === 'chat/turnStarted');
  expect(started?.action.message).toMatchObject({ origin: { kind: 'agent' } });
  expect(own.map((e) => String(e.action.type)).filter((type) => type !== 'chat/isReadChanged').at(-1)).toBe('chat/turnComplete');
  // Its words are in it, between its start and its end, not lost and not in the prompted turn.
  const said = own.filter((e) => e.action.type === 'chat/delta' || e.action.type === 'chat/responsePart')
    .map((e) => JSON.stringify(e.action)).join('');
  expect(said).toContain('working on my own');
  expect(of(actions(p, chatUri), 't1').map((e) => JSON.stringify(e.action)).join('')).not.toContain('working on my own');
});

it('counts and logs an update that arrives outside every turn with no mark, rather than dropping it without a word', async () => {
  const { p, chatUri, logged } = await afterTurn('selfturn stray');
  await until(() => logged.some((one) => one.line.includes('outside every turn')));
  const line = logged.find((one) => one.line.includes('outside every turn'));
  expect(line?.line).toContain('agent_message_chunk');
  expect(line?.line).toContain('(1 so far');
  expect(line?.level).toBe('warn');
  // And no turn is made up for it.
  expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/turnStarted').map((e) => e.action.turnId)).toEqual(['t1']);
});

it('ends a turn the server started itself as abandoned when the server goes away before it ends', async () => {
  const { p, chatUri } = await afterTurn('selfturn quit');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/error'));
  const error = of(actions(p, chatUri), 'own-1').find((e) => e.action.type === 'chat/error');
  expect(error?.action.part).toMatchObject({ kind: 'error', error: { errorType: 'abandoned' } });
});

it('opens a turn the server started in the same burst as its answer to a prompt, once that prompt\'s turn ends, with its words', async () => {
  const { p, chatUri } = await afterTurn('selfturn burst');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/turnComplete'));
  const own = of(actions(p, chatUri), 'own-1');
  expect(own.find((e) => e.action.type === 'chat/turnStarted')?.action.message).toMatchObject({ origin: { kind: 'agent' } });
  expect(own.map((e) => JSON.stringify(e.action)).join('')).toContain('working on my own');
  expect(of(actions(p, chatUri), 't1').map((e) => JSON.stringify(e.action)).join('')).not.toContain('working on my own');
});

it('lets a prompt a client sends take the place of a turn the server started itself and never ended, and runs that prompt', async () => {
  const { p, client, chatUri } = await afterTurn('selfturn unended');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/turnStarted'));
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } },
    },
  });
  await until(() => of(actions(p, chatUri), 't2').some((e) => e.action.type === 'chat/turnComplete'));
  // The prompt took its place, as the host's state holds a turn handed while
  // another runs, and it is not opened again after.
  expect(of(actions(p, chatUri), 'own-1').filter((e) => e.action.type === 'chat/turnStarted')).toHaveLength(1);
  expect(actions(p, chatUri).at(-1)?.action.turnId ?? 't2').toBe('t2');
});

it('counts and logs the end of a turn that never opened, rather than dropping it without a word', async () => {
  const { logged } = await afterTurn('selfturn ghost');
  await until(() => logged.some((one) => one.line.includes('never opened here (nobody)')));
  expect(logged.find((one) => one.line.includes('never opened here'))?.level).toBe('warn');
});

it('logs updates outside every turn once a minute at most, with the running count, and the session\'s tally at its close', async () => {
  const { client, logged, uri } = await afterTurn('selfturn stray three');
  await until(() => logged.some((one) => one.line.includes('outside every turn')));
  await new Promise((r) => { setTimeout(r, 50); });
  expect(logged.filter((one) => one.line.includes('so far outside every turn'))).toHaveLength(1);
  opened.splice(0);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  expect(logged.some((one) => one.line.includes('3 updates outside every turn were not shown'))).toBe(true);
});

it('ends a turn the server started itself when the session closes before it ends', async () => {
  const { p, client, chatUri, uri } = await afterTurn('selfturn unended');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/turnStarted'));
  opened.splice(0);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  // It ends with the session, never left running in a chat nobody can reach.
  const ends = ['chat/turnComplete', 'chat/turnCancelled', 'chat/error'];
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => ends.includes(String(e.action.type))));
});

it('ends a turn the server started itself that the person interrupted as cancelled, not as an error', async () => {
  const { p, chatUri } = await afterTurn('selfturn interrupt');
  await until(() => of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/turnCancelled'));
  expect(of(actions(p, chatUri), 'own-1').some((e) => e.action.type === 'chat/error')).toBe(false);
});

const types = (notes: Note[], turnId: string): string[] =>
  of(notes, turnId).map((e) => String(e.action.type)).filter((type) => type !== 'chat/isReadChanged');

it('opens two turns the server started back to back while a prompt\'s turn was ending, each with its own words and its own end', async () => {
  const { p, chatUri } = await afterTurn('selfturn burst two');
  await until(() => of(actions(p, chatUri), 'own-2').some((e) => e.action.type === 'chat/turnComplete'));
  const said = (turnId: string) => of(actions(p, chatUri), turnId).map((e) => JSON.stringify(e.action)).join('');
  expect(types(actions(p, chatUri), 'own-1').at(0)).toBe('chat/turnStarted');
  expect(types(actions(p, chatUri), 'own-1').at(-1)).toBe('chat/turnComplete');
  expect(said('own-1')).toContain('first of mine');
  expect(said('own-1')).not.toContain('second of mine');
  expect(said('own-2')).toContain('second of mine');
  // The first ended before the second started.
  const all = actions(p, chatUri);
  expect(all.findIndex((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === 'own-1'))
    .toBeLessThan(all.findIndex((e) => e.action.type === 'chat/turnStarted' && e.action.turnId === 'own-2'));
});

it('ends a held turn whose own end never came as taken over when the server starts the next, and opens the next', async () => {
  const { p, chatUri } = await afterTurn('selfturn burst two first unended');
  await until(() => of(actions(p, chatUri), 'own-2').some((e) => e.action.type === 'chat/turnComplete'));
  expect(types(actions(p, chatUri), 'own-1').at(-1)).toBe('chat/turnCancelled');
  expect(of(actions(p, chatUri), 'own-1').map((e) => JSON.stringify(e.action)).join('')).toContain('first of mine');
});

it('counts a held turn a prompt took the place of before it opened, rather than opening it where its words are dropped', async () => {
  const { p, chatUri, logged } = await afterTurn('selfturn burst', 'hello');
  await until(() => of(actions(p, chatUri), 't2').some((e) => e.action.type === 'chat/turnComplete'));
  expect(of(actions(p, chatUri), 'own-1')).toEqual([]);
  const line = logged.find((one) => one.line.includes('a prompt took the place of before they opened'));
  expect(line?.line).toContain('own-1 (3 updates)');
  expect(line?.level).toBe('warn');
});

it('names every held turn a prompt took the place of in one line, and counts each by its updates, as the close tally does', async () => {
  const { p, client, chatUri, logged, uri } = await afterTurn('selfturn burst three turns', 'hello');
  await until(() => of(actions(p, chatUri), 't2').some((e) => e.action.type === 'chat/turnComplete'));
  const lines = logged.filter((one) => one.line.includes('took the place of before they opened'));
  expect(lines).toHaveLength(1);
  expect(lines[0]?.line).toContain('own-1 (3 updates), own-2 (3 updates), own-3 (3 updates)');
  expect(lines[0]?.line).toContain('(9 so far');
  for (const turnId of ['own-1', 'own-2', 'own-3']) expect(of(actions(p, chatUri), turnId)).toEqual([]);
  opened.splice(0);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  expect(logged.some((one) => one.line.includes('9 updates outside every turn were not shown'))).toBe(true);
});
