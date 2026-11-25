/**
 * `ahpd node rm` and `ahpd node add` at the terminal, with a daemon running.
 *
 * With no file named, the change goes to the running daemon's API, so the
 * daemon's own registry drops the node's connection at once. With no daemon,
 * the file is written as before. The daemon's end is a real listener on a real
 * port, as in `server-paths.test.ts`, because the forward is a request over the
 * network.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { RequestHandler } from '@cofold/remote';
import { Program } from '@cofold/terminal';
import { fileNodes, nodesFileOf, type LiveNodes, type Nodes } from '@ahpd/sdk';
import type { Options } from '../src/commands/options.js';
import { programGlobals } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry } from '../src/commands/served.js';
import { apiHandler, listenApi } from '../src/http.js';

let home: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-node-forward-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

/** The record a detached daemon writes of itself, which is what says one is up. */
const record = (api?: string): void => {
  writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
    pid: process.pid,
    url: 'ws://127.0.0.1:9187',
    connectUrl: 'ws://127.0.0.1:9187/?tkn=the-daemons-token',
    paths: [],
    startedAt: '',
    ...(api === undefined ? {} : { api }),
  }));
};

/** One line as `ahpd` reads it, in this process, with what it wrote and what it said kept apart. */
const line = async (words: string[]): Promise<{ code: number; out: string; err: string }> => {
  let out = '';
  let err = '';
  const program = new Program({
    name: 'ahpd',
    version: '0.0.0',
    registry: cliRegistry(),
    globals: programGlobals,
    io: { out: (text) => { out += text; }, err: (text) => { err += text; } },
  });
  return { code: await program.run(words), out, err };
};

/**
 * A daemon serving the API over its own users file, whose node registry
 * records each call: that registry is what drops a node's connection.
 */
const listening = async (): Promise<{ api: string; calls: string[]; nodes: Nodes; done(): Promise<void> }> => {
  const users = join(home, 'served-users.json');
  writeFileSync(users, JSON.stringify({ roles: {}, teams: [], projects: [], users: [] }));
  const file = fileNodes({ path: nodesFileOf(users) });
  const calls: string[] = [];
  const nodes: Nodes = {
    ...file,
    add: async (id) => { calls.push(`add ${id}`); return file.add(id); },
    remove: async (id) => { calls.push(`remove ${id}`); return file.remove(id); },
  };
  const bound = { port: 0 };
  const handler: RequestHandler = apiHandler({
    registry: servedRegistry({
      options: { paths: [], users } as unknown as Options,
      configFile: join(home, 'served.json'),
      // The commands ask the registry to list, add and remove, and nothing else.
      nodes: nodes as unknown as LiveNodes,
      running: () => ({ pid: process.pid, url: `ws://127.0.0.1:${String(bound.port)}`, host: '127.0.0.1', port: bound.port, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => ({ restartDelayMs: 0 }),
    }),
    token: 'the-daemons-token',
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, bound.port),
  });
  const api = await listenApi(handler, { port: 0, host: '127.0.0.1' });
  bound.port = api.port;
  return { api: `http://127.0.0.1:${String(api.port)}`, calls, nodes, done: async () => { await api.close(); } };
};

it('removes a node through the running daemon, whose registry drops it', async () => {
  const daemon = await listening();
  record(daemon.api);
  try {
    await daemon.nodes.add('box');
    daemon.calls.length = 0;
    const removed = await line(['node', 'rm', 'box', '--yes']);
    expect(removed.code).toBe(0);
    expect(removed.out).toBe('Removed node box on the running daemon. Its token is refused and its connection is closed.\n');
    expect(daemon.calls).toEqual(['remove box']);
    expect(await daemon.nodes.list()).toEqual([]);

    // A node the daemon does not hold is the daemon's own refusal.
    await expect(line(['node', 'rm', 'box', '--yes'])).rejects.toThrow('No node called box.');
  }
  finally { await daemon.done(); }
});

it('replaces a node\'s token through the running daemon', async () => {
  const daemon = await listening();
  record(daemon.api);
  try {
    const first = await daemon.nodes.add('box');
    daemon.calls.length = 0;
    const added = await line(['node', 'add', 'box']);
    expect(added.code).toBe(0);
    const token = added.out.trim();
    expect(daemon.calls).toEqual(['add box']);
    expect(await daemon.nodes.verify(token)).toBe('box');
    expect(await daemon.nodes.verify(first)).toBeUndefined();
  }
  finally { await daemon.done(); }
});

it('writes the file as before when no daemon is running', async () => {
  const users = join(home, 'users.json');
  writeFileSync(users, JSON.stringify({ roles: {}, teams: [], projects: [], users: [] }));
  writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ users }));
  const nodes = fileNodes({ path: nodesFileOf(users) });
  await nodes.add('box');
  const removed = await line(['node', 'rm', 'box', '--yes']);
  expect(removed.code).toBe(0);
  expect(removed.out).toBe('Removed node box. Its token is refused from now on.\n');
  expect(await nodes.list()).toEqual([]);
});
