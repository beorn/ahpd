import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Agent } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import type { SessionStore } from '../../sdk/src/types/sessions.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { acpAgent } from '../src/index.js';

/*
 * Two records on one account, each listing the folder it runs in.
 *
 * Codex keeps every thread of an account in one CODEX_HOME, so two records on
 * that account spawn servers that read the same store. A record that asked
 * `session/list` about no folder was answered with every thread the account
 * holds, and the host gives a thread it has no record of to the first agent
 * that listed it, in load order: a thread made in one seat's folder was
 * credited to another seat's record, and resuming it there was refused. Each
 * record asks about its own folder, as ACP's `cwd` filter means, so a thread
 * is listed by the record whose folder it ran in.
 *
 * The fixture's `ACP_LISTED` is that one store: both records hand the same
 * value to the servers they spawn.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

const made: string[] = [];

afterEach(async () => {
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-listing-cwd-'));
  made.push(path);
  return path;
};

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: async () => {},
});

/** A record on the shared account, running in `cwd`, with its own request log. */
const record = (provider: string, cwd: string, store: string): { agent: Agent; log: string } => {
  const log = join(scratch(), 'requests.jsonl');
  return { agent: acpAgent({ command: process.execPath, args: [FIXTURE], cwd, env: { ACP_LOG: log, ACP_LISTED: store }, provider }), log };
};

const thread = (sessionId: string, cwd: string, title: string) => ({ sessionId, cwd, title, updatedAt: new Date().toISOString() });

/** The listing a client reads, as `[session id, provider]`, after asking for every external session. */
const listing = async (agents: Agent[], sessions: SessionStore, path: string): Promise<Map<string, { provider: string; title: string }>> => {
  const host = createHost({ path, agents, sessions });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { showExternalSessions: 'last30Days' } } } });
  const answer = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; provider: string; title: string }[];
  };
  return new Map(answer.items.map((one) => [one.resource.slice(one.resource.lastIndexOf('/') + 1), { provider: one.provider, title: one.title }]));
};

const listedCwds = (log: string): unknown[] => readFileSync(log, 'utf8').split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as { method: string; params?: { cwd?: unknown } })
  .filter((one) => one.method === 'session/list')
  .map((one) => one.params?.cwd);

it('credits a thread to the record of the folder it ran in, not to the first record on its account', async () => {
  const six = scratch();
  const one = scratch();
  const store = JSON.stringify([thread('native-six', six, 'Made in six'), thread('native-one', one, 'Made in one')]);
  // The record in the other folder is loaded first, so it is the one that took
  // every thread when each record listed the whole account.
  const first = record('acp-cwd-one', one, store);
  const second = record('acp-cwd-six', six, store);

  const rows = await listing([first.agent, second.agent], memorySessions(), scratch());

  expect(rows.get('native-six')).toEqual({ provider: 'acp-cwd-six', title: 'Made in six' });
  expect(rows.get('native-one')).toEqual({ provider: 'acp-cwd-one', title: 'Made in one' });
  // What each record asked its server, read off the wire rather than inferred.
  expect(new Set(listedCwds(first.log))).toEqual(new Set([one]));
  expect(new Set(listedCwds(second.log))).toEqual(new Set([six]));
});

it('still lists a recorded session that ran in a folder neither record runs in, under the agent it was recorded with', async () => {
  const six = scratch();
  const one = scratch();
  const worktree = scratch();
  const store = JSON.stringify([thread('recorded-six', worktree, 'Recorded in a worktree')]);
  const first = record('acp-kept-one', one, store);
  const second = record('acp-kept-six', six, store);
  // What the host wrote when the session ran: its agent and its folder. This is
  // the catalogue's recorded-folder lookup (`kept.recordedFolders`), which no
  // folder-filtered listing offers a row for.
  const sessions = memorySessions();
  sessions.setProvider('recorded-six', 'acp-kept-six');
  sessions.setWorkingDirectory?.('recorded-six', worktree);

  const rows = await listing([first.agent, second.agent], sessions, scratch());

  expect(rows.get('recorded-six')).toEqual({ provider: 'acp-kept-six', title: 'Recorded in a worktree' });
});
