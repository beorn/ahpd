import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { fileUsers } from '../../sdk/src/access/users.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import type { Users } from '../../sdk/src/types/users.js';
import { PROCESS_CASE_MS } from '../../../tools/wait.ts';

// Each scripted CLI call is a process of its own: see `PROCESS_CASE_MS`.
vi.setConfig({ testTimeout: PROCESS_CASE_MS });

/*
 * The `x-ahpd/computers/*` commands, each beside the resource call it shares
 * its rules with.
 *
 * The plugin is loaded over the scripted `docker`, under a users file, so what
 * is under test is what each person may send, what a command makes, and what a
 * subscriber of the channel hears.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const ROOT = 'ahp-root://';
const URI = 'x-ahpd-computers://';

type Bag = Record<string, any>;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-computer-commands-'));
  writeFileSync(join(home, 'users.json'), JSON.stringify({
    roles: {
      keeper: ['computer:read', 'computer:put', 'computer:delete'],
      maker: ['computer:read', 'computer:put'],
    },
    users: [{ id: 'ana', roles: ['keeper'] }, { id: 'bo', roles: ['maker'] }, { id: 'cy', roles: [] }],
  }));
});
afterEach(async () => {
  await closeAll();
  rmSync(home, { recursive: true, force: true });
});

/** The plugin over the fixture, and a host under the users file. */
const served = async () => {
  const config = join(home, 'config');
  const { options, problems } = await loadPlugins(
    [{ name: SOURCE, options: { command: process.execPath, args: [FIXTURE], env: { DOCKER_FAKE_STATE: join(home, 'docker.json') } } }],
    {
      base: {
        path: '/tmp/computer-commands',
        agents: [{ ...echo({ path: '/tmp/computer-commands', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
        resources: fileResources(),
      },
      configDir: config,
      cwd: REPO,
      log: () => {},
    },
  );
  keeping(options);
  expect(problems).toEqual([]);
  const users = fileUsers({ path: join(home, 'users.json') });
  const host = createHost({ ...options, users });
  keeping(options, host);
  return { host, users };
};

/** A client signed in as `id`, whose channel actions are kept. */
const as = async (host: ReturnType<typeof createHost>, users: Users, id: string) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  });
  await client.handle({ method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => error as Bag,
  );
  /** Each action on the channel so far, as `verb id state`. */
  const heard = () => seen
    .filter((one) => one.method === 'action' && one.params.channel === URI)
    .map((one) => `${String(one.params.action.type).split('/').pop()} ${String(one.params.action.id)}${one.params.action.record === undefined ? '' : ` ${String(one.params.action.record.state)}`}`);
  return { call, heard };
};

it('makes, stops, starts, restarts and removes a machine, and the channel hears each', async () => {
  const { host, users } = await served();
  const ana = await as(host, users, 'ana');
  expect(await ana.call('subscribe', { channel: URI })).toMatchObject({ result: { snapshot: { state: { records: [] } } } });

  expect(await ana.call('x-ahpd/computers/create', { name: 'box', manifest: {} })).toEqual({ result: {} });
  expect(await ana.call('resourceRead', { channel: ROOT, uri: 'computer://box/state' })).toMatchObject({ result: { data: 'running\n' } });
  // The caller is the owner, as a resource write records it.
  const status = JSON.parse((await ana.call('resourceRead', { channel: ROOT, uri: 'computer://box/status' })).result.data as string) as Bag;
  expect(status.Config.Labels['ahpd.owner']).toBe('user:ana');

  expect(await ana.call('x-ahpd/computers/stop', { name: 'box' })).toEqual({ result: {} });
  expect(await ana.call('resourceRead', { channel: ROOT, uri: 'computer://box/state' })).toMatchObject({ result: { data: 'stopped\n' } });
  expect(await ana.call('x-ahpd/computers/start', { name: 'box' })).toEqual({ result: {} });
  expect(await ana.call('x-ahpd/computers/restart', { name: 'box' })).toEqual({ result: {} });
  expect(await ana.call('x-ahpd/computers/remove', { name: 'box' })).toEqual({ result: {} });
  expect(await ana.call('resourceRead', { channel: ROOT, uri: 'computer://box/state' })).toMatchObject({ code: -32008 });

  expect(ana.heard()).toEqual(['added box running', 'changed box stopped', 'changed box running', 'removed box']);
}, 30000);

it('refuses a body a resource write refuses, with the same sentence', async () => {
  const { host, users } = await served();
  const ana = await as(host, users, 'ana');
  const write = await ana.call('resourceWrite', { channel: ROOT, uri: 'computer://box', data: '[1]' });
  const command = await ana.call('x-ahpd/computers/create', { name: 'box', manifest: [1] });
  expect(write).toMatchObject({ code: -32602 });
  expect(command).toEqual(write);
  expect(command).toMatchObject({ message: 'A computer is made from a JSON object, and that body is not one' });

  const image = await ana.call('x-ahpd/computers/create', { name: 'box', manifest: { image: 7 } });
  expect(image).toEqual(await ana.call('resourceWrite', { channel: ROOT, uri: 'computer://box', data: '{"image":7}' }));

  // A machine that is there already, and one that is not.
  await ana.call('x-ahpd/computers/create', { name: 'box', manifest: {} });
  expect(await ana.call('x-ahpd/computers/create', { name: 'box', manifest: {} }))
    .toEqual(await ana.call('resourceWrite', { channel: ROOT, uri: 'computer://box', data: '{}' }));
  expect(await ana.call('x-ahpd/computers/stop', { name: 'gone' }))
    .toEqual(await ana.call('resourceWrite', { channel: ROOT, uri: 'computer://gone/state', data: 'stopped' }));
  expect(await ana.call('x-ahpd/computers/remove', { name: 'gone' }))
    .toEqual(await ana.call('resourceDelete', { channel: ROOT, uri: 'computer://gone' }));

  expect(await ana.call('x-ahpd/computers/start', {})).toMatchObject({
    code: -32602, message: "x-ahpd/computers/start needs name, the computer's name, with no / or ?",
  });
  expect(await ana.call('x-ahpd/computers/create', { name: 'box/state' })).toMatchObject({
    code: -32602, message: "x-ahpd/computers/create needs name, the computer's name, with no / or ?",
  });
}, 30000);

it('refuses remove without computer:delete, and every command and the channel without the grants', async () => {
  const { host, users } = await served();
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');
  const cy = await as(host, users, 'cy');
  await ana.call('x-ahpd/computers/create', { name: 'box', manifest: {} });

  expect(await bo.call('x-ahpd/computers/remove', { name: 'box' })).toMatchObject({ code: -32009, message: 'bo may not computer:delete here' });
  expect(await bo.call('x-ahpd/computers/stop', { name: 'box' })).toEqual({ result: {} });

  for (const verb of ['create', 'start', 'stop', 'restart']) {
    expect(await cy.call(`x-ahpd/computers/${verb}`, { name: 'box', manifest: {} })).toMatchObject({ code: -32009, message: 'cy may not computer:put here' });
  }
  expect(await cy.call('x-ahpd/computers/remove', { name: 'box' })).toMatchObject({ code: -32009, message: 'cy may not computer:delete here' });
  expect(await cy.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });

  // The machine is still there, and the one without the grant heard nothing.
  expect(await ana.call('resourceRead', { channel: ROOT, uri: 'computer://box/state' })).toMatchObject({ result: { data: 'stopped\n' } });
  expect(cy.heard()).toEqual([]);
}, 30000);

it('makes a machine for the root connection owned as a resource write from it is', async () => {
  const { host } = await served();
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {}, notify: () => {},
  }, undefined, true);
  await client.handle({ method: 'initialize', params: { clientId: 'door', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then((result) => ({ result: result as Bag }), (error) => error as Bag);
  expect(await call('x-ahpd/computers/create', { name: 'bycommand', manifest: {} })).toEqual({ result: {} });
  expect(await call('resourceWrite', { channel: ROOT, uri: 'computer://bywrite', data: '{}' })).toMatchObject({ result: {} });
  const owner = async (name: string) => (JSON.parse((await call('resourceRead', { channel: ROOT, uri: `computer://${name}/status` })).result.data as string) as Bag).Config.Labels['ahpd.owner'];
  const written = await owner('bywrite');
  expect(written).toMatch(/^root:/);
  expect(await owner('bycommand')).toBe(written);
}, 30000);

it('sends removed to a subscriber who loses computer:read when the users file changes', async () => {
  const { host, users } = await served();
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');
  await ana.call('x-ahpd/computers/create', { name: 'box', manifest: {} });
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ result: { snapshot: { state: { records: [{ id: 'box' }] } } } });

  writeFileSync(join(home, 'users.json'), JSON.stringify({
    roles: { keeper: ['computer:read', 'computer:put', 'computer:delete'] },
    users: [{ id: 'ana', roles: ['keeper'] }, { id: 'bo', roles: [] }],
  }));
  await expect.poll(() => bo.heard(), { timeout: 5000 }).toEqual(['removed box']);
}, 30000);
