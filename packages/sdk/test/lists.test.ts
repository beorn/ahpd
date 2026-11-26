import { loggerOf } from '../src/log.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, it, vi } from 'vitest';
import { invokeOperation, OPERATION_COMMAND, pluginOperationChannels } from '../src/kinds/operations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { HostOptions } from '../src/types/host.js';
import type { ListKindHandle, ListRow } from '../src/types/lists.js';
import type { Contribution, LoaderContext } from '../src/types/plugin.js';
import { actions, claude, createHost, hello, machine, peer, resetSdk, settle } from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A list end to end, through `createHost`: a todo plugin declares
 * `x-ahpd-todos` and its todo kind, and an issue plugin adds a kind to it. A
 * client reads the list in `ahpd.channels`, a second one subscribes, and the
 * first runs create, complete and remove through `x-ahpd/invokeOperation`,
 * which the daemon serves over every folded channel. Unloading the issue
 * plugin is a live fold, and the list loses its kind.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LIST = 'x-ahpd-todos://';

const context = (): LoaderContext => ({
  path: HERE, paths: [HERE], version: sdkVersion(), hostName: 'test', configDir: HERE, log: loggerOf(() => {}), say: () => {},
});

/** The todos the todo kind keeps, across folds. */
const todos = new Map<string, ListRow>();

/** The todo plugin: the list and its kind, keeping rows in `todos`. */
const todoPlugin = (): Contribution => {
  const { host, contribution } = pluginHost('todos', context(), { contracts: { lists: ['todo'], kinds: ['todo'] } });
  host.registerList({ name: 'todo', channel: 'x-ahpd-todos', title: 'Todos', filters: [{ field: 'done', type: 'boolean' }], sorts: ['title'] });
  let next = 0;
  const handle: ListKindHandle = host.registerKind({
    channel: 'x-ahpd-todos',
    name: 'todo',
    title: 'Todo',
    description: 'One thing to do.',
    schema: { type: 'object', required: ['title'], properties: { title: { type: 'string', title: 'Title' }, done: { type: 'boolean', title: 'Done' } } },
    operations: [{ id: 'complete', label: 'Done', icon: 'check', offered: (record) => record['done'] !== true }],
    rows: { list: () => [...todos.values()], read: (id) => todos.get(id) },
    invoke: (operation, row, input) => {
      if (operation === 'create') {
        next += 1;
        const id = `t-${String(next)}`;
        todos.set(id, { id, record: { done: false, ...input } });
        handle.changed(undefined, id);
        return id;
      }
      if (operation === 'remove') todos.delete(row!.id);
      if (operation === 'complete') todos.set(row!.id, { ...row!, record: { ...row!.record, done: true } });
      handle.changed(undefined, row!.id);
      return undefined;
    },
  });
  return contribution;
};

/** The issue plugin: one kind in the todo list, with one row. */
const issuePlugin = (): Contribution => {
  const { host, contribution } = pluginHost('issues', context(), { contracts: { kinds: ['issue'] } });
  host.registerKind({
    channel: 'x-ahpd-todos',
    name: 'issue',
    title: 'Issue',
    schema: { type: 'object', properties: { title: { type: 'string' } } },
    rows: { list: () => [{ id: 'i-1', record: { title: 'A broken build' } }], read: (id) => (id === 'i-1' ? { id, record: { title: 'A broken build' } } : undefined) },
    invoke: () => undefined,
  });
  return contribution;
};

/** A host over the plugins, with the daemon's operation command over whatever fold it holds now. */
function served() {
  let held: HostOptions | undefined;
  const base: HostOptions = {
    path: HERE,
    agents: [claude({ paths: [HERE] })],
    ...machine(),
    // The daemon lists the command's own grant, as it does for its other channels.
    grants: { operation: { operations: ['invoke'] } },
    methods: {
      [OPERATION_COMMAND]: {
        by: 'ahpd',
        name: OPERATION_COMMAND,
        method: invokeOperation({ channels: () => pluginOperationChannels(held?.channels), check: () => {} }),
      },
    },
  };
  const fold = (contributions: Contribution[]): HostOptions => {
    const folded = foldHostOptions(base, contributions);
    expect(folded.problems).toEqual([]);
    held = folded.options;
    return held;
  };
  return { host: createHost(fold([todoPlugin(), issuePlugin()])), fold };
}

/** A client watching the root, and what it was sent. */
async function clientOf(host: ReturnType<typeof createHost>, id: string) {
  const p = peer();
  const client = host.accept(p);
  const ready = await client.handle(hello(['0.9.0'], { clientId: id, initialSubscriptions: ['ahp-root://'] })) as { snapshots: { state: { _meta: Record<string, unknown> } }[] };
  return { p, client, meta: ready.snapshots[0]!.state._meta };
}

/** The `ahpd.channels` entry of the list. */
const entryOf = (meta: Record<string, unknown>) =>
  (meta['ahpd.channels'] as { scheme: string; kinds?: Record<string, { operations: { id: string }[] }> }[]).find((one) => one.scheme === 'x-ahpd-todos');

it('lists the list in ahpd.channels with both kinds and every operation in full', async () => {
  todos.clear();
  const { host } = served();
  const { meta } = await clientOf(host, 'ana');
  const entry = entryOf(meta)!;
  expect(entry).toMatchObject({ scheme: 'x-ahpd-todos', title: 'Todos', grant: 'todo:get' });
  expect(Object.keys(entry.kinds!)).toEqual(['todo', 'issue']);
  expect(entry.kinds!['todo']).toMatchObject({
    title: 'Todo',
    description: 'One thing to do.',
    operations: [
      { id: 'todo/create', label: 'Todo', scopes: ['list'], grant: 'todo:put', input: { required: ['title'] } },
      { id: 'todo/update', label: 'Edit', scopes: ['todo'], grant: 'todo:put' },
      { id: 'todo/remove', label: 'Remove', confirmation: 'Remove this todo?', scopes: ['todo'], grant: 'todo:delete' },
      { id: 'todo/complete', label: 'Done', icon: 'check', scopes: ['todo'], grant: 'todo:put' },
    ],
  });
  // A status is the channel's, and a kind's offered is the host's: neither is advertised.
  expect(entry.kinds!['todo']!.operations[0]).not.toHaveProperty('status');
  expect(entry.kinds!['todo']!.operations[3]).not.toHaveProperty('offered');
});

it('creates, completes and removes a todo through invokeOperation, and a second client gets each action', async () => {
  todos.clear();
  const { host } = served();
  const ana = await clientOf(host, 'ana');
  const bo = await clientOf(host, 'bo');
  const opened = await bo.client.handle({ method: 'subscribe', params: { channel: LIST } }) as { snapshot: { state: { records: { id: string }[] } } };
  expect(opened.snapshot.state.records.map((one) => one.id)).toEqual(['i-1']);

  const invoke = (operationId: string, extra: Record<string, unknown> = {}) =>
    ana.client.handle({ method: OPERATION_COMMAND, params: { channel: LIST, operationId, ...extra } });
  expect(await invoke('todo/create', { input: { title: 'Buy milk' } })).toMatchObject({ id: 't-1', kind: 'todo', record: { title: 'Buy milk', done: false } });
  await settle();
  await invoke('todo/complete', { target: { id: 't-1' } });
  await settle();
  await invoke('todo/remove', { target: { id: 't-1' } });
  await settle();

  const told = actions(bo.p, LIST).map((one) => one.action).filter((one) => one['id'] === 't-1');
  expect(told[0]).toMatchObject({ type: 'x-ahpd-todos/added', record: { title: 'Buy milk', done: false } });
  expect(told.some((one) => one['type'] === 'x-ahpd-todos/changed' && (one['record'] as { done: boolean }).done)).toBe(true);
  expect(told.at(-1)).toEqual({ type: 'x-ahpd-todos/removed', id: 't-1' });
});

it('drops a kind from the entry and the snapshot when its plugin unloads', async () => {
  todos.clear();
  const { host, fold } = served();
  expect(host.replace(fold([todoPlugin()]))).toBeUndefined();
  await settle();
  const { client, meta } = await clientOf(host, 'cy');
  expect(Object.keys(entryOf(meta)!.kinds!)).toEqual(['todo']);
  const opened = await client.handle({ method: 'subscribe', params: { channel: LIST } }) as { snapshot: { state: { records: unknown[] } } };
  expect(opened.snapshot.state.records).toEqual([]);
});
