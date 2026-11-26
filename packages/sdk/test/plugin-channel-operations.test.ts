import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { invokeOperation, pluginOperationChannels } from '../src/kinds/operations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ChannelOperation } from '../src/types/kinds.js';
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

const RESTART: ChannelOperation = { id: 'svc/restart', label: 'Restart', scopes: ['service'], grant: 'svc:restart', status: 'idle' };

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

it('cannot offer operations on a scheme a plugin folded earlier registered, the daemon\'s included', () => {
  const { host: first, contribution: daemon } = pluginHost('ahpd', context());
  first.registerChannel('x-ahpd-tunnels', { grant: 'tunnel:read', snapshot: () => ({}) });
  const { host: rogue, contribution } = pluginHost('rogue', context());
  rogue.registerGrants('rogue', { operations: ['go'] });
  rogue.registerChannel('x-ahpd-tunnels', {
    grant: 'rogue:go',
    snapshot: () => ({}),
    operations: { operations: () => [{ ...RESTART, grant: 'rogue:go' }], run: async () => ({}) },
  });
  const folded = foldHostOptions({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [daemon, contribution]);
  expect(folded.problems).toContain('plugin rogue registers channel x-ahpd-tunnels, which plugin ahpd already registered');
  expect(pluginOperationChannels(folded.options.channels)).toEqual({});
});

it('runs an operation of a channel that leaves out offers, begin and settle', async () => {
  const { host: plugin, contribution } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  plugin.registerChannel('x-svc', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: { operations: () => [RESTART], run: async (_operation, target) => ({ restarted: target }) },
  });
  const folded = foldHostOptions({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [contribution]);
  expect(folded.problems).toEqual([]);
  const method = invokeOperation({ channels: () => pluginOperationChannels(folded.options.channels), check: () => {} });
  expect(await method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'anything' } }, holding(['svc:restart']), 'c1'))
    .toEqual({ restarted: 'anything' });
});

it('runs a list-scoped operation with no target, and checks its input against its schema', async () => {
  const ADD: ChannelOperation = { id: 'svc/add', label: 'Add', scopes: ['list'], grant: 'svc:restart', status: 'idle', input: { type: 'object', required: ['name'] } };
  const checked: unknown[] = [];
  const one = served({ operations: () => [RESTART, ADD], run: async (operation, target, input) => ({ id: operation.id, target: target ?? null, input }) });
  const method = invokeOperation({
    channels: () => one.channels,
    check: (value) => { checked.push(value); if (typeof value !== 'object' || value === null || !('name' in value)) throw new Error('input needs a name'); },
  });
  expect(await method.handle({ channel: 'x-svc://', operationId: 'svc/add', input: { name: 'web' } }, holding(['svc:restart']), 'c1'))
    .toEqual({ id: 'svc/add', target: null, input: { name: 'web' } });
  await expect(method.handle({ channel: 'x-svc://', operationId: 'svc/add', input: {} }, holding(['svc:restart']), 'c1')).rejects.toThrow('input needs a name');
  expect(checked).toEqual([{ name: 'web' }, {}]);
});

it('leaves out a listed operation it cannot serve, says it once, and reports it and an undeclared grant at the load', async () => {
  const listed = (): unknown => [RESTART, { id: 'svc/broken', scopes: 'service', grant: 'svc:restart' }, { ...RESTART }, { ...RESTART, id: 'svc/stop', grant: 'svc:stop' }];
  const { host: plugin, contribution } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  plugin.registerChannel('x-svc', { grant: 'svc:read', snapshot: () => ({}), operations: { operations: listed as () => ChannelOperation[], run: async () => ({}) } });
  const folded = foldHostOptions({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [contribution]);
  expect(folded.problems).toEqual([
    'plugin svc lists operation svc/broken at x-svc://, which is not served: its scopes are not a list of names',
    'plugin svc lists operation svc/restart at x-svc://, which is not served: an earlier entry has its id',
    'plugin svc requires svc:stop, which no entry of ahpd.grants lists',
  ]);
  const said: string[] = [];
  const channels = pluginOperationChannels(folded.options.channels, (line) => { said.push(line); });
  expect(channels['x-svc://']!.operations().map((one) => one.id)).toEqual(['svc/restart', 'svc/stop']);
  channels['x-svc://']!.operations();
  expect(said).toEqual(folded.problems.slice(0, 2));
});

it('refuses a call naming the plugin when its list throws, and reports it at the load', async () => {
  const { host: plugin, contribution } = pluginHost('svc', context());
  plugin.registerChannel('x-svc', { grant: 'svc:read', snapshot: () => ({}), operations: { operations: () => { throw new Error('config unreadable'); }, run: async () => ({}) } });
  const folded = foldHostOptions({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [contribution]);
  expect(folded.problems).toContain('plugin svc could not list its operations at x-svc://: config unreadable');
  const method = invokeOperation({ channels: () => pluginOperationChannels(folded.options.channels), check: () => {} });
  await expect(method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, undefined, 'c1'))
    .rejects.toThrow(/^plugin svc could not list its operations at x-svc:\/\/$/);
  // Nobody is let in by a list that cannot be read, and the gate says nothing of why.
  expect(await method.authorize!({ channel: 'x-svc://', operationId: 'svc/restart' }, holding(['svc:restart']))).toBe(false);
});

it('admits at the gate a caller holding the operation\'s grant', async () => {
  const one = served();
  expect(await one.method.authorize!({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, holding(['svc:restart']))).toBe(true);
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

it('refuses a registration whose operations side is not an object, or is missing a function', () => {
  const { host: plugin } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  expect(() => plugin.registerChannel('x-svc', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: { operations: () => [], begin: () => {}, settle: () => {} } as unknown as NonNullable<PluginChannel['operations']>,
  })).toThrow('operations.run');
  expect(() => plugin.registerChannel('x-svc2', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: 'restart' as unknown as NonNullable<PluginChannel['operations']>,
  })).toThrow('operations');
  expect(() => plugin.registerChannel('x-svc3', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: { operations: () => [], run: async () => ({}), begin: 'yes' } as unknown as NonNullable<PluginChannel['operations']>,
  })).toThrow('operations.begin');
});

it('asks offers who the reader is, and a refused one starts nothing', async () => {
  const begun: string[] = [];
  const one = served({
    offers: (_target, _operationId, reader) => reader?.id === 'bo',
    begin: (id) => { begun.push(id); },
  });
  await expect(one.method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, holding(['svc:restart']), 'c1'))
    .rejects.toThrow('svc/restart is not offered on web now');
  expect(begun).toEqual([]);
  expect(one.ran).toEqual([]);
  const bo = { ...holding(['svc:restart']), id: 'bo' };
  expect(await one.method.handle({ channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } }, bo, 'c1')).toEqual({ restarted: 'web' });
});

it.each([
  ['throws', () => { throw new Error('status unwritable'); }],
  ['rejects', async () => { throw new Error('status unwritable'); }],
])('answers what run answered when begin and settle %s', async (_how, fails) => {
  const { host: plugin, contribution } = pluginHost('svc', context());
  plugin.registerGrants('svc', { operations: ['restart'] });
  let run = async (): Promise<unknown> => ({ restarted: true });
  plugin.registerChannel('x-svc', {
    grant: 'svc:read',
    snapshot: () => ({}),
    operations: { operations: () => [RESTART], run: () => run(), begin: fails, settle: fails },
  });
  const folded = foldHostOptions({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [contribution]);
  const said: string[] = [];
  const channels = pluginOperationChannels(folded.options.channels, (line) => { said.push(line); });
  const method = invokeOperation({ channels: () => channels, check: () => {} });
  const params = { channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } };
  expect(await method.handle(params, undefined, 'c1')).toEqual({ restarted: true });
  run = async () => { throw new Error('unit not found'); };
  await expect(method.handle(params, undefined, 'c1')).rejects.toThrow('unit not found');
  await new Promise((done) => { setImmediate(done); });
  expect([...new Set(said)].sort()).toEqual([
    'plugin svc failed in begin at x-svc://: status unwritable',
    'plugin svc failed in settle at x-svc://: status unwritable',
  ]);
  expect(said).toHaveLength(4);
});

it('leaves out an operation with no scopes, and an async list is refused', () => {
  const said: string[] = [];
  const at = (operations: () => unknown) => pluginOperationChannels(
    { 'x-svc': { by: 'svc', channel: { grant: 'svc:read', snapshot: () => ({}), operations: { operations: operations as () => ChannelOperation[], run: async () => ({}) } } } },
    (line) => { said.push(line); },
  )['x-svc://']!;
  expect(at(() => [{ ...RESTART, scopes: [] }]).operations()).toEqual([]);
  expect(() => at(async () => { throw new Error('late'); }).operations()).toThrow('not a list');
  expect(said[0]).toBe('plugin svc lists operation svc/restart at x-svc://, which is not served: its scopes are not a list of names');
});

it('tells run who sent the command, from the host and never from the input', async () => {
  const callers: unknown[] = [];
  const one = served({
    run: async (_operation, _target, input, _reader, caller) => {
      callers.push({ caller, input });
      return {};
    },
  });
  const params = { channel: 'x-svc://', operationId: 'svc/restart', target: { id: 'web' } };
  // A relaying plugin's connection: the host resolved the person it acts for.
  await one.method.handle(params, holding(['svc:restart']), 'pipe-1', 'user:ana');
  // An owner planted in the input is the input's, and changes nothing about who sent it.
  await one.method.handle({ ...params, input: { owner: 'user:mallory' } }, holding(['svc:restart']), 'pipe-1', 'user:ana');
  // A host with no users directory has no owner.
  await one.method.handle(params, undefined, 'c2');
  expect(callers).toEqual([
    { caller: { client: 'pipe-1', owner: 'user:ana' }, input: undefined },
    { caller: { client: 'pipe-1', owner: 'user:ana' }, input: { owner: 'user:mallory' } },
    { caller: { client: 'c2' }, input: undefined },
  ]);
});
