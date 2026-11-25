import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { gitChanges } from '../src/sessions/changes.js';
import { createHost as makeHost } from '../src/host.js';
import { fileResources, uriOf } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Start } from '../src/types/agent.js';
import type { ChangesetFile } from '../src/types/changes.js';
import type { Peer } from '../src/types/rpc.js';
import { gitSync } from '../../../tools/git.ts';

/*
 * AHP 1.1.0's `ChangesetFile.status` and `nonce`: a file an agent is editing
 * says `Editing`, and an operation that names a nonce acts only on the changes
 * that nonce was shown with.
 */

const URI = 'ahp-session:/s';
const CHANGESET = `${URI}/changeset/uncommitted`;

let made: string[] = [];
let hosts: ReturnType<typeof makeHost>[] = [];
afterEach(async () => {
  for (const host of hosts) await host.close();
  hosts = [];
  for (const dir of made) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  made = [];
});

const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-editing-'));
  made.push(dir);
  gitSync(['init', '-q', '-b', 'main', dir]);
  gitSync(['-C', dir, 'config', 'user.email', 'test@example.com']);
  gitSync(['-C', dir, 'config', 'user.name', 'Test']);
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(dir, name), 'one\n');
  gitSync(['-C', dir, 'add', '-A']);
  gitSync(['-C', dir, 'commit', '-q', '-m', 'first']);
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(dir, name), 'two\n');
  return dir;
};

const waitFor = async (ready: () => boolean): Promise<void> => {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    if (ready()) return;
    await new Promise((r) => { setTimeout(r, 25); });
  }
  throw new Error('the change never arrived');
};

/** One client watching the uncommitted changeset, with the session's own `Start` in hand. */
const opened = async (dir: string) => {
  let start: Start | undefined;
  const base = echo({ path: dir });
  const host = makeHost({
    path: dir,
    agents: [{ ...base, create: (given: Start) => { start = given; return base.create(given); } }],
    resources: fileResources(),
    changes: gitChanges(),
  });
  hosts.push(host);
  const said: { channel: string; action: Record<string, unknown> }[] = [];
  const peer: Peer = {
    send: () => {},
    notify: (method, params) => { if (method === 'action') said.push(params as (typeof said)[number]); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['1.1.0'] } });
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo', workingDirectories: [uriOf(dir)] } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  const read = async (): Promise<ChangesetFile[]> =>
    ((await client.handle({ method: 'subscribe', params: { channel: CHANGESET } })) as { snapshot: { state: { files: ChangesetFile[] } } }).snapshot.state.files;
  const rowOf = async (name: string): Promise<ChangesetFile> => {
    const row = (await read()).find((one) => one.id === uriOf(join(dir, name)));
    if (row === undefined) throw new Error(`no row for ${name}`);
    return row;
  };
  /** The statuses `changeset/fileSet` said for one file, oldest first. */
  const statuses = (name: string) => said
    .filter((one) => one.channel === CHANGESET && one.action.type === 'changeset/fileSet')
    .map((one) => one.action.file as ChangesetFile)
    .filter((file) => file.id === uriOf(join(dir, name)))
    .map((file) => file.status ?? 0);
  const discard = (name: string, nonce?: string) => client.handle({
    method: 'invokeChangesetOperation',
    params: {
      channel: CHANGESET, operationId: 'discard',
      target: { kind: 'resource', resource: uriOf(join(dir, name)), ...(nonce === undefined ? {} : { nonce }) },
    },
  });
  return { start: () => start as Start, rowOf, statuses, discard, said };
};

it('marks a file from the start of an edit to its end, and no other', async () => {
  const dir = repository();
  const { start, rowOf, statuses } = await opened(dir);
  await rowOf('a.txt');
  await start().onFileEdit?.('t1', join(dir, 'a.txt'), 'before');
  expect(statuses('a.txt')).toEqual([1]);
  expect((await rowOf('a.txt')).status).toBe(1);
  expect((await rowOf('b.txt')).status).toBeUndefined();

  writeFileSync(join(dir, 'a.txt'), 'six\n');
  await start().onFileEdit?.('t1', join(dir, 'a.txt'), 'after');
  await waitFor(() => statuses('a.txt').at(-1) === 0);
  expect((await rowOf('a.txt')).status ?? 0).toBe(0);
});

it('keeps the mark while another turn still edits the file', async () => {
  const dir = repository();
  const changes = gitChanges();
  const path = join(dir, 'a.txt');
  await changes.observe?.(dir, 's', 't1', path, 'before');
  await changes.observe?.(dir, 'other', 't9', path, 'before');
  await changes.observe?.(dir, 's', 't1', path, 'after');
  expect(changes.editing?.(path)).toBe(true);
  await changes.observe?.(dir, 'other', 't9', path, 'after');
  expect(changes.editing?.(path)).toBe(false);
});

it('lets go of an edit that never ended when its turn does', async () => {
  const dir = repository();
  const { start, rowOf, statuses } = await opened(dir);
  await rowOf('a.txt');
  await start().onFileEdit?.('t1', join(dir, 'a.txt'), 'before');
  start().emit('chat', { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await waitFor(() => statuses('a.txt').at(-1) === 0);
  expect((await rowOf('a.txt')).status ?? 0).toBe(0);
});

it('gives a row a nonce that moves with the content, where no count does', async () => {
  const dir = repository();
  const changes = gitChanges();
  const nonceOf = async (name: string) =>
    (await changes.state(dir, 's', 'uncommitted'))?.files.find((one) => one.id === uriOf(join(dir, name)))?.nonce;
  await changes.refresh?.(dir);
  const before = await nonceOf('a.txt');
  const beside = await nonceOf('b.txt');
  expect(before).toMatch(/^[0-9a-f]{16}$/);
  writeFileSync(join(dir, 'a.txt'), 'owt\n');
  expect(await changes.refresh?.(dir)).toBe(true);
  expect(await nonceOf('a.txt')).not.toBe(before);
  expect(await nonceOf('b.txt')).toBe(beside);
});

it('runs an operation with the nonce shown, and one with none', async () => {
  const dir = repository();
  const { rowOf, discard } = await opened(dir);
  await discard('a.txt', (await rowOf('a.txt')).nonce);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8').trim()).toBe('one');
  await discard('b.txt');
  expect(readFileSync(join(dir, 'b.txt'), 'utf8').trim()).toBe('one');
});

it('refuses an operation on changes that moved since they were shown, and shows them', async () => {
  const dir = repository();
  const { rowOf, discard, said } = await opened(dir);
  const shown = (await rowOf('a.txt')).nonce;
  writeFileSync(join(dir, 'a.txt'), 'owt\n');
  await expect(discard('a.txt', shown)).rejects.toMatchObject({
    code: -32011, message: 'The changes to a.txt changed since they were shown.',
  });
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('owt\n');
  const now = (await rowOf('a.txt')).nonce;
  expect(now).not.toBe(shown);
  expect(JSON.stringify(said.filter((one) => one.channel === CHANGESET))).toContain(now);
  await discard('a.txt', now);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8').trim()).toBe('one');
});
