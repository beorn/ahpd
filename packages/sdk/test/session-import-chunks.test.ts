/*
 * A conversation imported into a session, in chunks.
 *
 * `vscode/stageCreateSessionImportChunk` holds each chunk on the connection
 * that sent it, and `createSession` names the transfer in
 * `_meta['vscode.importConversation']`. The host joins, reads and validates
 * the value, and hands the turns to the agent before the session starts.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/meta/vscode/agentHostCreateSessionImportMeta.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { gitWorktrees, worktreesOf } from '../src/repo/worktrees.js';
import {
  CREATE_SESSION_IMPORT_CHUNK_CHARS,
  CREATE_SESSION_IMPORT_MAX_STAGED_CHARS,
  STAGE_CREATE_SESSION_IMPORT_METHOD,
  noStagedImports,
  stageImportChunk,
  takeImport,
} from '../src/host/sessionimport.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitSync } from '../../../tools/git.ts';
import { hello, peer, settle } from './support/host.js';
import { call, directory, hello as helloUser, host as usersHost, peer as usersPeer, signIn } from './users-gate-helpers.js';
import type { Agent, ImportedConversation, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';

const META = 'vscode.importConversation';
const SESSION = 'ahp-session:/imported';

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

const made: string[] = [];
afterEach(() => {
  for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** A folder under a fresh root, made now. */
const folderIn = (root: string, name: string): string => {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** One completed turn of an imported conversation. */
const turnOf = (id: string, text: string): Record<string, unknown> => ({
  id,
  startedAt: new Date(0).toISOString(),
  message: { text, origin: { kind: 'user' } },
  responseParts: [{ kind: 'markdown', id: `part-${id}`, content: `answer to ${text}` }],
  usage: undefined,
  state: 'complete',
});

/** The echo backend, keeping what it was handed and in which order. */
const importing = (base: string): { agent: Agent; imports: ImportedConversation[]; order: string[] } => {
  const plain = echo({ path: base, pace: 0 });
  const imports: ImportedConversation[] = [];
  const order: string[] = [];
  const agent: Agent = {
    ...plain,
    importConversation: async (imported) => {
      order.push('import');
      imports.push(imported);
    },
    create: (start: Start): Session => {
      order.push('create');
      return plain.create(start);
    },
  };
  return { agent, imports, order };
};

/** A client on a host of its own, introduced, and what the introduction answered. */
const clientOf = async (path: string, agents: Agent[]): Promise<{ client: Client; opened: { _meta?: Record<string, unknown> } }> => {
  const host = createHost({ path, agents });
  const client = host.accept(peer());
  const opened = await client.handle(hello(['0.9.0'])) as { _meta?: Record<string, unknown> };
  return { client, opened };
};

it('takes three staged chunks, and hands the turns to the agent before it starts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent, imports, order } = importing(root);
  const { client, opened } = await clientOf(root, [agent]);
  // The capability is the host's, said while an agent here can write a history.
  expect(opened._meta?.['vscode.createSessionImport']).toBe(true);

  const value = JSON.stringify({
    turns: [turnOf('old-1', 'first question'), turnOf('old-2', 'second question')],
    model: { id: 'claude-sonnet-4' },
    title: 'Imported chat',
  });
  const size = Math.ceil(value.length / 3);
  for (const chunk of [value.slice(0, size), value.slice(size, size * 2), value.slice(size * 2)]) {
    await client.handle({ method: STAGE_CREATE_SESSION_IMPORT_METHOD, params: { transferId: 'a-transfer', chunk } });
  }

  await client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { transferId: 'a-transfer' } },
    },
  });
  await settle();

  expect(order).toEqual(['import', 'create']);
  const imported = imports.at(0);
  if (imported === undefined) throw new Error('the agent was handed no conversation');
  expect(imported.uri).toBe(SESSION);
  expect(imported.turns.map((one) => one.message.text)).toEqual(['first question', 'second question']);
  // Each turn is this session's own, never the id the other host used.
  expect(imported.turns.map((one) => one.id)).not.toContain('old-1');
  expect(imported.turns.map((one) => one.id)).not.toContain('old-2');
  expect(new Set(imported.turns.map((one) => one.id)).size).toBe(2);
  expect(imported.model).toEqual({ id: 'claude-sonnet-4' });
  expect(imported.title).toBe('Imported chat');
});

it('reads an inline conversation, and makes no title for a blank one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent, imports } = importing(root);
  const { client } = await clientOf(root, [agent]);

  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/inline',
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { turns: [turnOf('old', 'hello')], title: '   ' } },
    },
  });
  await settle();

  const imported = imports.at(0);
  if (imported === undefined) throw new Error('the agent was handed no conversation');
  expect(imported.title).toBeUndefined();
  expect(imported.turns).toHaveLength(1);
});

it('refuses a chunk that is blank, empty or past the chunk limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent } = importing(root);
  const { client } = await clientOf(root, [agent]);

  for (const params of [
    { transferId: '   ', chunk: 'a' },
    { transferId: 't', chunk: '' },
    { transferId: 't', chunk: 'a'.repeat(CREATE_SESSION_IMPORT_CHUNK_CHARS + 1) },
  ]) {
    await expect(client.handle({ method: STAGE_CREATE_SESSION_IMPORT_METHOD, params }))
      .rejects.toThrow('Invalid createSession import chunk');
  }
});

it('drops a transfer and refuses the chunk that would pass the staged limit', () => {
  const state = noStagedImports();
  state.transfers.set('held', ['1234']);
  state.totalChars = CREATE_SESSION_IMPORT_MAX_STAGED_CHARS - 4;

  expect(stageImportChunk(state, 'held', 'abcde')).toBe('exceeds');
  // The transfer it named is gone, and so are the characters it held.
  expect(state.transfers.has('held')).toBe(false);
  expect(state.totalChars).toBe(CREATE_SESSION_IMPORT_MAX_STAGED_CHARS - 8);
  // A chunk under the limit is held, and joined back whole.
  expect(stageImportChunk(state, 'held', 'ab')).toBe('staged');
  expect(takeImport(state, 'held')).toBe('ab');
  expect(takeImport(state, 'held')).toBeUndefined();
});

it('refuses an unknown transfer and a malformed value', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent, imports } = importing(root);
  const { client } = await clientOf(root, [agent]);

  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { transferId: 'never-staged' } },
    },
  })).rejects.toThrow('Invalid createSession importConversation metadata');

  await client.handle({ method: STAGE_CREATE_SESSION_IMPORT_METHOD, params: { transferId: 'bad', chunk: '{"turns":[{"id":1}]}' } });
  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { transferId: 'bad' } },
    },
  })).rejects.toThrow('Invalid createSession importConversation metadata');

  // A model with a blank id is malformed, as the reference's reader says.
  await client.handle({
    method: STAGE_CREATE_SESSION_IMPORT_METHOD,
    params: { transferId: 'model', chunk: JSON.stringify({ turns: [turnOf('old', 'hi')], model: { id: '  ' } }) },
  });
  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { transferId: 'model' } },
    },
  })).rejects.toThrow('Invalid createSession importConversation metadata');

  expect(imports).toHaveLength(0);
});

it('drops the chunks a connection staged when it closes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent, imports } = importing(root);
  const { client } = await clientOf(root, [agent]);

  await client.handle({
    method: STAGE_CREATE_SESSION_IMPORT_METHOD,
    params: { transferId: 'gone', chunk: JSON.stringify({ turns: [turnOf('old', 'hi')] }) },
  });
  client.close();

  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { transferId: 'gone' } },
    },
  })).rejects.toThrow('Invalid createSession importConversation metadata');
  expect(imports).toHaveLength(0);
});

it('refuses an agent that cannot import, and advertises nothing for it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { client, opened } = await clientOf(root, [echo({ path: root, pace: 0 })]);
  expect(opened._meta?.['vscode.createSessionImport']).toBeUndefined();

  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      _meta: { [META]: { turns: [turnOf('old', 'hi')] } },
    },
  })).rejects.toThrow('The agent echo cannot import a conversation.');
});

it('refuses an import beside a fork', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const { agent, imports } = importing(root);
  const { client } = await clientOf(root, [agent]);

  await expect(client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'echo',
      workingDirectories: [uriOf(root)],
      source: { kind: 'fork' },
      _meta: { [META]: { turns: [turnOf('old', 'hi')] } },
    },
  })).rejects.toThrow('An imported conversation cannot be combined with a fork.');
  expect(imports).toHaveLength(0);
});

it('cuts the worktree before the session starts, not at its first turn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-import-'));
  made.push(root);
  const base = folderIn(root, 'base');
  gitSync(['-C', base, 'init', '-b', 'main']);
  gitSync(['-C', base, 'config', 'user.email', 'example@example.com']);
  gitSync(['-C', base, 'config', 'user.name', 'Example']);
  writeFileSync(join(base, 'a.txt'), 'one\n');
  gitSync(['-C', base, 'add', '.']);
  gitSync(['-C', base, 'commit', '-m', 'first']);

  const { agent, order } = importing(base);
  const starts: string[] = [];
  const withStarts: Agent = {
    ...agent,
    create: (start: Start) => {
      starts.push(start.workingDirectory ?? '');
      return agent.create(start);
    },
  };
  const host = createHost({ path: root, agents: [withStarts], worktrees: gitWorktrees() });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));

  await client.handle({
    method: 'createSession',
    params: {
      channel: 'ahp-session:/imported-tree',
      provider: 'echo',
      workingDirectories: [uriOf(base)],
      config: { isolation: 'worktree' },
      _meta: { [META]: { turns: [turnOf('old', 'hi')] } },
    },
  });
  await settle();

  expect(order).toEqual(['import', 'create']);
  expect(starts).toHaveLength(1);
  expect(starts[0]?.startsWith(worktreesOf(base))).toBe(true);
});

it('stages for a user who may create a session, and refuses one who may not', async () => {
  const users = usersHost({ users: directory({ ana: ['session:read'], bo: ['session:create'] }) });

  const bo = users.accept(usersPeer());
  await helloUser(bo, 'bo');
  await signIn(bo, 'bo');
  expect(await call(bo, STAGE_CREATE_SESSION_IMPORT_METHOD, { transferId: 't', chunk: '{"turns":[]}' }))
    .toEqual({ result: {} });

  const ana = users.accept(usersPeer());
  await helloUser(ana, 'ana');
  await signIn(ana, 'ana');
  expect(await call(ana, STAGE_CREATE_SESSION_IMPORT_METHOD, { transferId: 't', chunk: 'x' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('session:create') });
});
