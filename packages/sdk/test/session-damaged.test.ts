/**
 * A session whose file cannot be read is shown as failed and can be deleted.
 *
 * The four rows of issue 471: a damaged file, with the external sessions of the
 * root shown and hidden, and the same session readable beside them.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileSessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Agent, Listed } from '../src/types/agent.js';

let root: string;
let dir: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-damaged-')); dir = join(root, 'sessions'); mkdirSync(dir); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });
const ROOT = 'ahp-root://';
const listed: Listed = { id: 'a', title: 'A', createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), workingDirectories: [] };

const serving = async (mode: string) => {
  const agent: Agent = { ...echo({ path: root, pace: 0 }), list: async () => [listed] };
  const host = createHost({ path: root, agents: [agent], sessions: fileSessions({ dir }) });
  const client = host.accept(peer(), undefined, true);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config: { showExternalSessions: mode } } } });
  return client;
};
type Row = { resource: string; provider: string; status: number; lifecycle?: string; creationError?: { message: string } };
const list = async (client: Awaited<ReturnType<typeof serving>>): Promise<Row[]> =>
  ((await client.handle({ method: 'listSessions', params: { channel: ROOT } })) as { items: Row[] }).items;

for (const mode of ['none', 'last30Days']) {
  it(`lists a damaged file as one failed row with the external sessions at ${mode}`, async () => {
    writeFileSync(join(dir, 'a.json'), 'not json');
    const rows = await list(await serving(mode));
    const failed = rows.filter((row) => row.lifecycle === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.resource).toBe('ahp-session:/a');
    expect(failed[0]?.creationError?.message).toContain('not JSON');
    // The agent's own row for the same id is the external one, and is not an active ordinary row.
    expect(rows.filter((row) => row.resource === 'ahp-session:/a' && row.lifecycle !== 'failed')).toEqual([]);
  });
}

it('starts and lists beside a damaged file, and a null file is damaged', async () => {
  writeFileSync(join(dir, 'a.json'), 'null');
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ version: 1, id: 'b', flags: 0, provider: 'echo' }));
  const rows = await list(await serving('none'));
  expect(rows.filter((row) => row.lifecycle === 'failed').map((row) => row.resource)).toEqual(['ahp-session:/a']);
});

it('deletes a damaged session, which removes its file, and a prune leaves it', async () => {
  writeFileSync(join(dir, 'a.json'), 'not json');
  const client = await serving('none');
  await list(client);
  expect(readdirSync(dir)).toEqual(['a.json']);
  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/a' } });
  expect(existsSync(join(dir, 'a.json'))).toBe(false);
  expect((await list(client)).filter((row) => row.lifecycle === 'failed')).toEqual([]);
});
