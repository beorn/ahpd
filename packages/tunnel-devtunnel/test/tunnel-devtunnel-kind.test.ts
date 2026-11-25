import { invokeOperation, loggerOf, memoryRecords, tunnelsChannel } from '@ahpd/sdk';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { checkTunnelKind } from '../../sdk/src/plugins/validate.js';
import type { Alert, LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Tunnel, TunnelReport } from '../../sdk/src/types/tunnels.js';
import { TUNNEL_PORT } from '../src/discovery.js';
import { devtunnelKind, NAME, OPERATIONS, SCHEMA } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import type { Service } from '../src/service.js';

/*
 * The kind as the host registers it: the form, the verbs, the system tunnel and
 * the settings a start reads from a record.
 *
 * A start here runs over a service that is a few arrays, so the settings are
 * checked where the kind reads them. What a start reaches of the SDK is in
 * `tunnel-devtunnel.test.ts`; this file is the declaration a client reads and
 * the host checks.
 */

/** The service of a case that starts nothing. */
const unreached = (): Service => ({
  add: async () => { throw new Error('this test starts no tunnel'); },
  access: async () => { throw new Error('this test starts no tunnel'); },
  replace: async () => { throw new Error('this test starts no tunnel'); },
  carry: () => { throw new Error('this test starts no tunnel'); },
  remove: async () => { throw new Error('this test starts no tunnel'); },
  restart: async () => { throw new Error('this test starts no tunnel'); },
  forget: async () => {},
  show: async () => { throw new Error('this test starts no tunnel'); },
  close: async () => { throw new Error('this test starts no tunnel'); },
});

/** A service that serves the port it is given, and says what it was asked. */
const serving = (): {
  service: Service;
  added: { connector: string; port: number; anonymous: boolean }[];
} => {
  const added: { connector: string; port: number; anonymous: boolean }[] = [];
  return {
    service: {
      add: async (connector, port, anonymous) => {
        added.push({ connector, port, anonymous });
        return { remote: { id: 'tunnel-id', labels: [] } };
      },
      access: async () => {},
      replace: async () => undefined,
      carry: () => {},
      remove: async () => {},
      restart: async () => {},
      forget: async () => {},
      show: async () => undefined,
      close: async () => {},
    },
    added,
  };
};

/** One record of the kind, as the host hands it over. */
const recordOf = (settings: Record<string, unknown>): Tunnel => ({
  id: 't1',
  kind: NAME,
  plugin: 'tunnel-devtunnel',
  purpose: 'person',
  enabled: true,
  settings,
});

/** The kind, the plugin host it is registered through, and the alerts it raised. */
const kindOf = (over: Partial<KindOptions> = {}) => {
  const alerts: Alert[] = [];
  const context: LoaderContext = {
    path: '/work', paths: ['/work'], version: '0.6.3', hostName: 'test', configDir: '/work', log: loggerOf(() => {}), say: () => {},
  };
  const { host } = pluginHost('tunnel', context, {
    alert: (alert) => { alerts.push(alert); },
  });
  const kind = devtunnelKind({
    plugin: host,
    service: unreached(),
    anonymous: false,
    keep: true,
    open: () => true,
    daemonPort: () => TUNNEL_PORT,
    guarded: () => false,
    ...over,
  });
  return { kind, alerts };
};

it('passes the registration check, with the connector mark, the port and anonymous off', () => {
  expect(() => { checkTunnelKind(kindOf().kind, 'tunnel-devtunnel'); }).not.toThrow();

  const properties = SCHEMA['properties'] as Record<string, Record<string, unknown>>;
  expect(properties['connector']).toMatchObject({ type: 'string', 'x-ahpd-connector': NAME });
  expect(properties['port']).toMatchObject({ type: 'number' });
  expect(properties['anonymous']).toMatchObject({ type: 'boolean', default: false });
  expect(SCHEMA['required']).toEqual(['connector', 'port']);
});

it('declares the person setting as `user:` and an id, which a bare id is not', () => {
  const properties = SCHEMA['properties'] as Record<string, Record<string, unknown>>;
  const person = properties['person'];
  expect(person).toMatchObject({ type: 'string', pattern: '^user:.+$', title: 'Person' });
  const pattern = new RegExp(String(person?.['pattern']), 'u');
  expect(pattern.test('user:ada')).toBe(true);
  expect(pattern.test('ada')).toBe(false);
  expect(pattern.test('user:')).toBe(false);
});

it('starts a record that names a person, and serves its port', async () => {
  const { service, added } = serving();
  const { kind } = kindOf({ service });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187, person: 'user:ada' }), (report) => { reports.push(report); });

  expect(added).toEqual([{ connector: 'mine', port: 9187, anonymous: false }]);
  expect(reports.at(-1)).toMatchObject({ status: 'running' });
});

it('refuses a record whose person is not `user:` and an id, and starts nothing', async () => {
  const { service, added } = serving();
  const { kind } = kindOf({ service });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187, person: 'ada' }), (report) => { reports.push(report); });

  expect(added).toEqual([]);
  expect(reports.at(-1)?.status).toBe('error');
  expect(reports.at(-1)?.error).toContain('person');
});

it('lists start, stop, restart and anonymous, and anonymous takes on', () => {
  expect(OPERATIONS.map((one) => one.id)).toEqual(['start', 'stop', 'restart', 'anonymous']);
  const anonymous = OPERATIONS.find((one) => one.id === 'anonymous');
  expect(anonymous?.input).toMatchObject({
    type: 'object',
    properties: { on: { type: 'boolean' } },
    required: ['on'],
  });
});

/** A service that puts a port up and takes it down, with no network behind it. */
const puttingUp = (): Service => ({
  add: async (_connector, port) => ({ remote: { id: 't1', labels: [] }, url: `https://port-${port}.example.com/` }),
  access: async () => {},
  replace: async () => undefined,
  carry: () => {},
  remove: async () => {},
  restart: async () => {},
  forget: async () => {},
  show: async () => undefined,
  close: async () => {},
});

it('answers the system tunnel with its connector and the well-known port', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
  });
});

it('answers the system tunnel with its person when one is set', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true, person: 'user:ada' });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
    person: 'user:ada',
  });
});

it('lists on a devtunnel record only the operations its status offers now', async () => {
  const URI = 'x-ahpd-tunnels://';
  const collection = await memoryRecords().collection('tunnels', { format: 'json' });
  const tunnels = tunnelsChannel({
    collection,
    kinds: () => ({ devtunnel: { ...kindOf({ service: puttingUp() }).kind, by: 'tunnel-devtunnel' } }),
    vault: () => undefined,
    check: () => {},
  });
  const command = invokeOperation({ channels: () => ({ [URI]: tunnels.operations }), check: () => {} });

  // A create starts the tunnel, so it is running from its first row.
  const made = await command.handle({
    channel: URI,
    operationId: 'devtunnel/create',
    input: { connector: 'mine', port: 8080 },
  }, undefined, 'c1') as Record<string, unknown>;
  const id = String(made['id']);

  const idsOf = async (): Promise<string[]> => {
    const state = await tunnels.channel.channel.snapshot(URI, undefined, 'c1') as Record<string, unknown>;
    const entry = (state['records'] as Record<string, unknown>[]).find((one) => one['id'] === id)!;
    return (entry['record'] as Record<string, unknown>)['operations'] as string[];
  };

  expect(await idsOf()).toEqual([
    'devtunnel/update', 'devtunnel/remove', 'devtunnel/disable', 'devtunnel/stop', 'devtunnel/restart', 'devtunnel/anonymous',
  ]);

  await command.handle({ channel: URI, operationId: 'devtunnel/stop', target: { id } }, undefined, 'c1');
  const stopped = await idsOf();
  expect(stopped).toContain('devtunnel/start');
  expect(stopped).not.toContain('devtunnel/stop');
  expect(stopped).not.toContain('devtunnel/restart');
  expect(stopped).toContain('devtunnel/anonymous');
});

it('adds no system tunnel without a connector, and says what to set', async () => {
  const { kind, alerts } = kindOf();

  expect(await kind.system?.({ port: 9187 })).toBeUndefined();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.level).toBe('warning');
  expect(alerts[0]?.text).toContain('`connector`');
  expect(alerts[0]?.text).toContain('Sign in to a devtunnel connector');
});

/*
 * A person reads the kind's own operations in the locale their client sent, so
 * each catalog the plugin ships names every one of them, and the create.
 */
it('has a label and a description in each catalog for every operation of the kind, and for its create', () => {
  for (const locale of ['pt', 'es']) {
    const catalog = JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8')) as { operations?: Record<string, { label?: string; description?: string }> };
    for (const id of ['create', ...OPERATIONS.map((one) => one.id)]) {
      expect(catalog.operations?.[id]?.label, `${locale} ${id} label`).toBeTruthy();
      expect(catalog.operations?.[id]?.description, `${locale} ${id} description`).toBeTruthy();
    }
  }
});

/** An error as the service's SDK throws one, with the HTTP status on its `response`. */
const refusedWith = (status: number): Error => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

/** A service that refuses its first `refusals` adds with 401, then serves, and counts every add. */
const refusingFirst = (refusals: number): { service: Service; adds: () => number } => {
  const { service } = serving();
  let tries = 0;
  return {
    service: {
      ...service,
      add: async (connector, port, anonymous) => {
        tries += 1;
        if (tries <= refusals) throw refusedWith(401);
        return service.add(connector, port, anonymous);
      },
    },
    adds: () => tries,
  };
};

/** Yield until `done` says so, or fail after a second. */
const until = async (done: () => boolean, what: string): Promise<void> => {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    if (done()) return;
    await new Promise((settled) => { setTimeout(settled, 2); });
  }
  throw new Error(`${what} never happened`);
};

/*
 * A start the service refused with 401 may be a token not yet refreshed, so
 * the record is started again after a wait, and when its connector next holds
 * a token, until it runs or a person stops it.
 */
it('starts a record again after a wait when the service refused its start with 401', async () => {
  const { service, adds } = refusingFirst(1);
  const { kind } = kindOf({ service, retryMs: { first: 10, most: 40 } });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187 }), (report) => { reports.push(report); });
  expect(reports.at(-1)?.status).toBe('error');
  expect(reports.at(-1)?.error).toContain('tried again at');

  await until(() => reports.at(-1)?.status === 'running', 'the second start');
  expect(adds()).toBe(2);
});

it('starts a waiting record when its connector holds a new token', async () => {
  const { service, adds } = refusingFirst(1);
  let told: ((connector: string) => void) | undefined;
  const { kind } = kindOf({ service, retryMs: { first: 60_000, most: 60_000 }, onHold: (listener) => { told = listener; return () => { told = undefined; }; } });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187 }), (report) => { reports.push(report); });
  expect(reports.at(-1)?.status).toBe('error');
  told?.('other');
  await new Promise((settled) => { setTimeout(settled, 20); });
  expect(adds()).toBe(1);

  told?.('mine');
  await until(() => reports.at(-1)?.status === 'running', 'the start on a new token');
  expect(adds()).toBe(2);
});

it('does not start a record again once a person stopped it', async () => {
  const { service, adds } = refusingFirst(10);
  const { kind } = kindOf({ service, retryMs: { first: 10, most: 10 } });
  const reports: TunnelReport[] = [];
  const tunnel = recordOf({ connector: 'mine', port: 9187 });

  await kind.create(tunnel, (report) => { reports.push(report); });
  await kind.invoke('stop', tunnel, (report) => { reports.push(report); }, undefined);
  await new Promise((settled) => { setTimeout(settled, 60); });
  expect(adds()).toBe(1);
  expect(reports.at(-1)?.status).toBe('stopped');
});
