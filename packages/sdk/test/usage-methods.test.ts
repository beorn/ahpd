/*
 * The usage commands, each beside the `usage:` read it answers for.
 *
 * Every case asks the same question twice, once as a read and once as a
 * command, and expects one answer: the command is the read's value, not its
 * text. The host half checks that the gate lets in and refuses the same readers
 * for both.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fileUsage, usageMethods, usageProvider } from '../src/usage/usage.js';
import { call, directory, hello, host, signIn } from './users-gate-helpers.js';
import type { ServedMethod } from '../src/types/plugin.js';
import type { ModelUse, Owner } from '../src/types/usage.js';
import type { Principal } from '../src/types/users.js';

/** A Wednesday, mid-morning, in the middle of the month the cases are written in. */
const NOW = '2026-10-07T12:00:00.000Z';

let folder: string;
beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), 'ahpd-usage-methods-')), 'usage');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(folder, { recursive: true, force: true });
});

const modelUse = (at: string, pools: string[], amount: number, owner: Owner = 'user:ana'): ModelUse => ({
  at,
  kind: 'model',
  source: 'gateway',
  owner,
  model: { name: 'anthropic/opus-5' },
  pools,
  cost: { amount, currency: 'usd', from: 'harness' },
});

/** A person, with what they may do and the teams and projects they belong to. */
const person = (id: string, grants: string[] = [], memberships: string[] = []): Principal => ({
  id,
  roles: ['r'],
  can: (one) => grants.includes(one),
  memberships,
});

const ADMIN = person('root', ['usage:read']);
const ANA = person('ana', [], ['backend']);

/** A store with records for ana, her team and beto, and the provider and commands over it. */
const over = async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-09-28T10:00:00.000Z', ['user:ana'], 9));
  await usage.record(modelUse('2026-10-02T10:00:00.000Z', ['user:ana', 'team:backend'], 1));
  await usage.record(modelUse('2026-10-06T09:00:00.000Z', ['user:ana'], 3));
  await usage.record(modelUse('2026-10-05T09:00:00.000Z', ['user:beto'], 2, 'user:beto'));
  const provider = usageProvider({ usage, timezone: 'UTC' });
  return { provider, methods: usageMethods(provider) };
};

it('names five commands, each needing usage:read and each with an authorize', async () => {
  const { methods } = await over();
  expect(Object.keys(methods)).toEqual([
    'x-ahpd/usage/pools', 'x-ahpd/usage/totals', 'x-ahpd/usage/range', 'x-ahpd/usage/records', 'x-ahpd/usage/groups',
  ]);
  for (const one of Object.values(methods)) {
    expect(one.grant).toBe('usage:read');
    expect(one.authorize).toBeDefined();
  }
});

it('answers what each read answers, for an admin and for a member', async () => {
  const { provider, methods } = await over();
  const read = async (uri: string, reader: Principal): Promise<unknown> => JSON.parse((await provider.read(uri, undefined, reader)).data);
  const ask = async (name: string, params: Record<string, unknown>, reader: Principal): Promise<unknown> =>
    methods[`x-ahpd/usage/${name}`]!.handle(params, reader, 'probe');

  for (const reader of [ADMIN, ANA]) {
    expect(await ask('totals', { pool: 'user:ana' }, reader)).toEqual(await read('usage://user%3Aana', reader));
    expect(await ask('range', { pool: 'user:ana', from: '2026-09-01', until: '2026-10-31' }, reader))
      .toEqual(await read('usage://user%3Aana/range?from=2026-09-01&until=2026-10-31', reader));
    expect(await ask('range', { pool: 'user:ana' }, reader)).toEqual(await read('usage://user%3Aana/range', reader));
    expect(await ask('records', { pool: 'user:ana' }, reader)).toEqual(await read('usage://user%3Aana/records', reader));
    expect(await ask('records', { pool: 'user:ana', from: '2026-09-01' }, reader))
      .toEqual(await read('usage://user%3Aana/records?from=2026-09-01', reader));
    expect(await ask('groups', { by: ['user', 'team'] }, reader)).toEqual(await read('usage://groups?by=user,team', reader));
    expect(await ask('groups', {}, reader)).toEqual(await read('usage://groups', reader));
  }

  // The pools are the listing of `usage://`, each named.
  const listed = async (reader: Principal) => (await provider.list('usage://', reader)).map((one) => one.name);
  expect(await ask('pools', {}, ADMIN)).toEqual([
    { pool: 'team:backend', kind: 'team', name: 'backend' },
    { pool: 'user:ana', kind: 'user', name: 'ana' },
    { pool: 'user:beto', kind: 'user', name: 'beto' },
  ]);
  expect((await ask('pools', {}, ADMIN) as { pool: string }[]).map((one) => one.pool)).toEqual(await listed(ADMIN));
  expect((await ask('pools', {}, ANA) as { pool: string }[]).map((one) => one.pool)).toEqual(await listed(ANA));
  expect(await listed(ANA)).toEqual(['team:backend', 'user:ana']);

  // A member's groups count only what she may read, as the read does.
  expect(await ask('groups', { by: ['user'] }, ANA)).toEqual([
    { keys: { user: 'user:ana' }, names: { user: 'ana' }, total: { calls: 2, providerUsd: 4, usd: 4 } },
  ]);
});

it('reads a first-party plugin\'s old pool name as its id', async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-02T10:00:00.000Z', ['plugin:bot'], 4, 'plugin:bot'));
  const methods = usageMethods(usageProvider({ usage, timezone: 'UTC' }));
  const ask = async (name: string, pool: string): Promise<unknown> =>
    methods[`x-ahpd/usage/${name}`]!.handle({ pool }, ADMIN, 'probe');

  for (const name of ['totals', 'range', 'records']) {
    expect(await ask(name, 'plugin:@ahpd/bot')).toEqual(await ask(name, 'plugin:bot'));
  }
  expect(await ask('records', 'plugin:@ahpd/bot')).toHaveLength(1);
});

it('lets a member in for her own pools and her team\'s, and nobody else\'s, as the scheme does', async () => {
  const { provider, methods } = await over();
  const may = async (name: string, params: Record<string, unknown>, reader: Principal) =>
    methods[`x-ahpd/usage/${name}`]!.authorize!(params, reader);

  for (const name of ['totals', 'range', 'records']) {
    expect(await may(name, { pool: 'user:ana' }, ANA)).toBe(await provider.authorize('usage://user%3Aana', ANA));
    expect(await may(name, { pool: 'user:ana' }, ANA)).toBe(true);
    expect(await may(name, { pool: 'team:backend' }, ANA)).toBe(true);
    expect(await may(name, { pool: 'user:beto' }, ANA)).toBe(await provider.authorize('usage://user%3Abeto', ANA));
    expect(await may(name, { pool: 'user:beto' }, ANA)).toBe(false);
    expect(await may(name, { pool: 'team:frontend' }, ANA)).toBe(false);
    expect(await may(name, {}, ANA)).toBe(false);
    expect(await may(name, { pool: 7 }, ANA)).toBe(false);
  }
  expect(await may('pools', {}, ANA)).toBe(await provider.authorize('usage://', ANA));
  expect(await may('groups', {}, ANA)).toBe(await provider.authorize('usage://groups', ANA));
  expect(await may('pools', {}, ANA)).toBe(true);
  expect(await may('groups', {}, ANA)).toBe(true);

  // The command refuses the pool itself too, with the sentence the read gives.
  const refusal = { code: -32009, message: 'ana may not usage:read here' };
  await expect(methods['x-ahpd/usage/totals']!.handle({ pool: 'user:beto' }, ANA, 'probe')).rejects.toMatchObject(refusal);
  await expect(provider.read('usage://user%3Abeto', undefined, ANA)).rejects.toMatchObject(refusal);
});

it('refuses a param of the wrong type, and a bound that is not a date with the read\'s sentence', async () => {
  const { provider, methods } = await over();
  const ask = async (name: string, params: Record<string, unknown>) =>
    methods[`x-ahpd/usage/${name}`]!.handle(params, ADMIN, 'probe');

  const notADate = 'from must be a date, as 2026-10-01, or an ISO 8601 instant: yesterday';
  await expect(provider.read('usage://user%3Aana/range?from=yesterday', undefined, ADMIN)).rejects.toMatchObject({ code: -32602, message: notADate });
  await expect(ask('range', { pool: 'user:ana', from: 'yesterday' })).rejects.toMatchObject({ code: -32602, message: notADate });
  await expect(ask('records', { pool: 'user:ana', from: 'yesterday' })).rejects.toMatchObject({ code: -32602, message: notADate });
  await expect(ask('groups', { from: 'yesterday' })).rejects.toMatchObject({ code: -32602, message: notADate });

  const notAKey = 'by takes user, team, project, tag, not model';
  await expect(provider.read('usage://groups?by=model', undefined, ADMIN)).rejects.toMatchObject({ message: notAKey });
  await expect(ask('groups', { by: ['model'] })).rejects.toMatchObject({ code: -32602, message: notAKey });

  await expect(ask('totals', {})).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/usage/totals needs pool, a pool key such as user:ana' });
  await expect(ask('totals', { pool: 7 })).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/usage/totals takes pool as a string' });
  await expect(ask('range', { pool: 'user:ana', until: 3 })).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/usage/range takes until as a string' });
  await expect(ask('groups', { by: 'user' })).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/usage/groups takes by as a list of user, team, project and tag' });
});

it('the host lets a member ask for her own pool and refuses another person\'s', async () => {
  const { provider, methods } = await over();
  const served: Record<string, ServedMethod> = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, { by: 'ahpd', name, method }]));
  const made = host({
    users: directory({ ana: [], root: ['usage:read'] }),
    resourceProviders: { usage: provider },
    methods: served,
  });
  const ana = made.accept({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });
  await hello(ana, 'ana'); await signIn(ana, 'ana');

  expect(await call(ana, 'x-ahpd/usage/totals', { pool: 'user:ana' })).toMatchObject({ result: { pool: 'user:ana', month: { usd: 4 } } });
  expect(await call(ana, 'x-ahpd/usage/totals', { pool: 'user:beto' })).toMatchObject({ code: -32009, message: 'ana may not usage:read here' });
  expect(await call(ana, 'x-ahpd/usage/range', { pool: 'user:beto' })).toMatchObject({ code: -32009 });
  expect(await call(ana, 'x-ahpd/usage/records', { pool: 'user:beto' })).toMatchObject({ code: -32009 });
  expect(await call(ana, 'x-ahpd/usage/pools', {})).toEqual({ result: [{ pool: 'user:ana', kind: 'user', name: 'ana' }] });
  expect(await call(ana, 'x-ahpd/usage/groups', { by: ['user'] })).toEqual({
    result: [{ keys: { user: 'user:ana' }, names: { user: 'ana' }, total: { calls: 2, providerUsd: 4, usd: 4 } }],
  });

  const root = made.accept({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });
  await hello(root, 'root'); await signIn(root, 'root');
  expect(await call(root, 'x-ahpd/usage/totals', { pool: 'user:beto' })).toMatchObject({ result: { pool: 'user:beto', month: { usd: 2 } } });
  await made.close();
});
