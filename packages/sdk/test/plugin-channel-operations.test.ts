import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { invokeOperation, pluginOperationChannels } from '../src/kinds/operations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Operation } from '../src/types/kinds.js';
import type { LoaderContext, PluginChannel } from '../src/types/plugin.js';
import type { Principal } from '../src/types/users.js';

/*
 * A plugin channel that offers operations to `x-ahpd/invokeOperation`.
 *
 * One plugin, `svc`, registers `x-svc` with an operations side offering one
 * operation on one service, `svc/restart`, under its own grant. The fold is the
 * one the daemon makes, and `pluginOperationChannels` is what the daemon hands
 * the command, so a case here runs the path a client's call takes.
 */

const root = '/nonexistent-plugin-channel-operations';

const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });

/** A caller holding exactly these grants. */
const holding = (grants: string[]): Principal => ({
  id: 'ana', roles: [], can: (grant: string) => grants.includes(grant),
});

const RESTART: Operation = { id: 'svc/restart', kind: 'svc', label: 'Restart', scopes: ['service'], grant: 'svc:restart', status: 'idle' };

/** The command over a fold holding the `svc` plugin, and what its channel was asked to do. */
function served(side: Partial<NonNullable<PluginChannel['operations']>> = {}) {
  const ran: { id: string; target?: string; reader?: string }[] = [];
  const settled: { id: string; target?: string; error?: string }[] = [];
  const { host: plugin, contribution } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  plugin.registerChannel('x-svc', {
    grant: 'svc:read',
    snapshot: () => ({ services: ['web'], operations: [RESTART] }),
    operations: {
      operations: () => [RESTART],
      begin: () => {},
      settle: (id, target, error) => { settled.push({ id, ...(target === undefined ? {} : { target }), ...(error === undefined ? {} : { error }) }); },
      offers: (target) => target === 'web',
      run: async (operation, target, _input, reader) => {
        ran.push({ id: operation.id, ...(target === undefined ? {} : { target }), ...(reader === undefined ? {} : { reader: reader.id }) });
        return { restarted: target };
      },
      ...side,
    },
  });
  const folded = foldHostOptions({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
  }, [contribution]);
  expect(folded.problems).toEqual([]);
  const channels = pluginOperationChannels(folded.options.channels);
  const method = invokeOperation({ channels: () => channels, check: () => {} });
  return { method, channels, ran, settled };
}

it('serves a plugin channel\'s operations at its scheme, and leaves out a channel with none', () => {
  const { channels } = served();
  expect(Object.keys(channels)).toEqual(['x-svc://']);
  expect(pluginOperationChannels({ 'x-plain': { channel: { grant: 'x:read', snapshot: () => ({}) } as PluginChannel } })).toEqual({});
});

it('leaves out a plugin channel at a URI the daemon serves, and says so naming both', () => {
  const problems: string[] = [];
  const side = { operations: () => [], begin: () => {}, settle: () => {}, run: async () => ({}) };
  const kept = pluginOperationChannels(
    { 'x-ahpd-tunnels': { by: 'rogue', channel: { grant: 'x:read', snapshot: () => ({}), operations: side } } },
    ['x-ahpd-tunnels://'],
    (line) => { problems.push(line); },
  );
  expect(kept).toEqual({});
  expect(problems).toEqual([
    'plugin rogue offers operations at x-ahpd-tunnels://, which the daemon\'s own channel serves; the daemon\'s is kept and the plugin\'s operations are not served',
  ]);
});

it('runs a plugin channel\'s operation through invokeOperation for a reader holding its grant', async () => {
  const one = served();
  const answer = await one.method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, holding(['svc:restart']), 'c1');
  expect(answer).toEqual({ restarted: 'web' });
  expect(one.ran).toEqual([{ id: 'svc/restart', target: 'web', reader: 'ana' }]);
  expect(one.settled).toEqual([{ id: 'svc/restart', target: 'web' }]);
});

it('refuses a reader without the operation\'s grant, at the gate and at the call', async () => {
  const one = served();
  const params = { channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } };
  expect(await one.method.authorize!(params, holding(['svc:read']))).toBe(false);
  await expect(one.method.handle(params, holding(['svc:read']), 'c1')).rejects.toThrow('svc:restart');
  expect(one.ran).toEqual([]);
});

it('refuses an operation the plugin did not offer', async () => {
  const one = served();
  await expect(one.method.handle({ channel: 'x-svc://', operationId: 'svc/delete', target: { id: 'web' } }, undefined, 'c1'))
    .rejects.toThrow('No operation called svc/delete on x-svc://');
  await expect(one.method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'db' } }, undefined, 'c1'))
    .rejects.toThrow('svc/restart is not offered on db now');
  expect(one.ran).toEqual([]);
});

it('settles a failed run with its error', async () => {
  const one = served({ run: async () => { throw new Error('unit not found'); } });
  await expect(one.method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, undefined, 'c1'))
    .rejects.toThrow('unit not found');
  expect(one.settled).toEqual([{ id: 'svc/restart', target: 'web', error: 'unit not found' }]);
});

it('refuses a registration whose operations side is missing a function', () => {
  const { host: plugin } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  expect(() => plugin.registerChannel('x-svc', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: { operations: () => [], begin: () => {}, settle: () => {} } as unknown as NonNullable<PluginChannel['operations']>,
  })).toThrow('operations.run');
});
