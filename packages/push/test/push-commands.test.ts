import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { holds } from '../../sdk/src/access/users.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';

/*
 * The `x-ahpd/push/*` commands and the `x-ahpd-push://` channel, on a host
 * with people: each person registers and removes their own devices, sees only
 * those, and is refused another person's through every door.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/push/src/index.ts';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const CHANNEL = 'x-ahpd-push://';

type Bag = Record<string, any>;

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** What a person here may do with devices, and no `push:read`. */
const PERSON: Grant[] = ['push:put', 'push:delete'];

/** A directory whose tokens are decided by hand: each token is the person's id. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    if (held === undefined) return undefined;
    const person: Principal = { id: token, roles: ['r'], can: (one) => holds(new Set<string>(held), one), memberships: [] };
    return person;
  },
  watch: () => ({ close: () => {} }),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

/** A host with the push plugin and these people. */
const made = async (tokens: Record<string, Grant[]>) => {
  const where = (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-push-commands-')));
  const { options, problems } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: {
      path: where,
      agents: [{ ...echo({ path: where, pace: 0 }), provider: 'base', displayName: 'Base' }],
      resources: fileResources(),
      users: directory(tokens),
    },
    configDir: where, cwd: REPO, log: () => {},
  });
  expect(problems).toEqual([]);
  return createHost(options);
};

type Host = Awaited<ReturnType<typeof made>>;

/** A client signed in as `token`, and what it heard on the channel as `type id` lines. */
const as = async (host: Host, token: string) => {
  const seen: Bag[] = [];
  const peer: Peer = {
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { if (method === 'action' && (params as Bag).channel === CHANNEL) seen.push((params as Bag).action as Bag); },
  };
  const client = host.accept(peer);
  const ready = await client.handle({ method: 'initialize', params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } }) as Bag;
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  const call = async (method: string, params: Bag): Promise<Bag | number> => await client.handle({ method, params }).then(
    (result) => result as Bag,
    (error: { code: number }) => error.code,
  );
  const heard = () => seen.map((one) => `${String(one.type).slice('x-ahpd-push/'.length)} ${String(one.id)}`);
  return { ready, call, heard };
};

const phone = (id: string, extra: Bag = {}) => ({ id, record: { token: TOKEN, platform: 'ios' }, ...extra });

it('advertises the commands and the channel', async () => {
  const host = await made({ ana: PERSON });
  try {
    const ana = await as(host, 'ana');
    const methods = (ana.ready._meta?.['ahpd.methods'] ?? []) as { method: string; grant: string }[];
    expect(methods.filter((one) => one.method.startsWith('x-ahpd/push/'))).toEqual([
      expect.objectContaining({ method: 'x-ahpd/push/put', grant: 'push:put' }),
      expect.objectContaining({ method: 'x-ahpd/push/remove', grant: 'push:delete' }),
    ]);
    expect(ana.ready._meta?.['ahpd.channels']).toEqual(expect.arrayContaining([expect.objectContaining({ scheme: 'x-ahpd-push' })]));
  }
  finally {
    await host.close();
  }
});

it('lists each person their own devices, with no credential, and sends each change', async () => {
  const host = await made({ ana: PERSON, bo: PERSON });
  try {
    const ana = await as(host, 'ana');
    const bo = await as(host, 'bo');
    expect(await bo.call('x-ahpd/push/put', phone('bo-phone'))).toEqual({});

    // Neither holds push:read, and each subscribes all the same.
    const first = await ana.call('subscribe', { channel: CHANNEL }) as Bag;
    expect(first.snapshot.state.records).toEqual([]);

    expect(await ana.call('x-ahpd/push/put', phone('ana-phone', { createOnly: true }))).toEqual({});
    expect(await ana.call('x-ahpd/push/put', phone('ana-phone', { createOnly: true }))).toBe(-32010);
    const answer = await bo.call('subscribe', { channel: CHANNEL }) as Bag;
    expect(answer.snapshot.state.records).toEqual([{ id: 'bo-phone', record: { platform: 'ios', owner: 'user:bo', client: 'bo' } }]);

    expect(await ana.call('x-ahpd/push/remove', { id: 'ana-phone' })).toEqual({});
    expect(await ana.call('x-ahpd/push/remove', { id: 'ana-phone' })).toBe(-32008);
    expect(ana.heard()).toEqual(['added ana-phone', 'removed ana-phone']);
    expect(bo.heard()).toEqual([]);
  }
  finally {
    await host.close();
  }
});

it('refuses another person\'s device through the commands, and everybody\'s through the resource methods', async () => {
  const host = await made({ ana: PERSON, bo: PERSON, admin: ['*:*'] });
  try {
    const ana = await as(host, 'ana');
    const bo = await as(host, 'bo');
    const admin = await as(host, 'admin');
    expect(await ana.call('x-ahpd/push/put', phone('shared'))).toEqual({});
    const uri = 'push://devices/shared';

    expect(await bo.call('x-ahpd/push/put', phone('shared'))).toBe(-32009);
    expect(await bo.call('x-ahpd/push/remove', { id: 'shared' })).toBe(-32009);
    expect(await bo.call('resourceWrite', { channel: ROOT, uri, data: JSON.stringify({ token: TOKEN, platform: 'android' }), encoding: 'utf-8' })).toBe(-32008);
    expect(await bo.call('resourceDelete', { channel: ROOT, uri })).toBe(-32008);
    // The owner too: a device changes by the commands alone.
    expect(await ana.call('resourceWrite', { channel: ROOT, uri, data: JSON.stringify({ token: TOKEN, platform: 'android' }), encoding: 'utf-8' })).toBe(-32008);
    expect(await ana.call('resourceDelete', { channel: ROOT, uri })).toBe(-32008);
    // Still ana's, as she registered it.
    const read = await admin.call('resourceRead', { channel: ROOT, uri }) as Bag;
    expect(JSON.parse(String(read.data))).toMatchObject({ platform: 'ios', owner: 'user:ana' });

    // An admin may take it out, as a holder of *:* may any bot.
    expect(await admin.call('x-ahpd/push/remove', { id: 'shared' })).toEqual({});
  }
  finally {
    await host.close();
  }
});
