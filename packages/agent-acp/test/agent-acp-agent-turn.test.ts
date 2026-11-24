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
async function afterTurn(text: string) {
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
  await until(() => actions(p, chatUri).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === 't1'));
  return { p, chatUri, logged };
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
  expect(line?.line).toContain('(1 so far)');
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
