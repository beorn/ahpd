import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { invokeOperation, pluginOperationChannels } from '../src/kinds/operations.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { ListKindHandle, ListRow } from '../src/types/lists.js';
import type { LoaderContext, ServedChannel } from '../src/types/plugin.js';
import type { Principal } from '../src/types/users.js';

/*
 * A list served by the fold: `todos` declares `x-ahpd-todos` and a todo kind
 * that keeps its rows in memory, and `issues` adds an issue kind with no
 * `done` field. The channel is driven as the host drives it: its snapshot is
 * read, `publish` and `subscribers` are set on the served entry, and
 * `x-ahpd/invokeOperation` runs its operations.
 */

const root = '/nonexistent-list-channel';
const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });

const holding = (grants: string[]): Principal => ({ id: 'ana', roles: [], can: (grant: string) => grants.includes(grant) });

const TODO_SCHEMA = {
  type: 'object',
  required: ['title'],
  properties: { title: { type: 'string' }, done: { type: 'boolean' } },
};

/** The two plugins, the fold, the command, and what each subscriber was sent. */
function served(options: { issuesThrow?: boolean } = {}) {
  const todos = new Map<string, ListRow>([
    ['t-milk', { id: 't-milk', owner: 'user:ana', record: { title: 'Buy milk', done: false } }],
    ['t-bob', { id: 't-bob', owner: 'user:ana', record: { title: 'Call Bob', done: true } }],
  ]);
  const invoked: string[] = [];
  let handle: ListKindHandle | undefined;
  let next = 0;
  const { host: todoPlugin, contribution: todoContribution } = pluginHost('todos', context());
  todoPlugin.registerList({
    name: 'todo',
    channel: 'x-ahpd-todos',
    title: 'Todos',
    filters: [{ field: 'done', type: 'boolean' }],
    search: ['title'],
    sorts: ['title'],
    defaultSort: 'title',
  });
  handle = todoPlugin.registerKind({
    channel: 'x-ahpd-todos',
    name: 'todo',
    title: 'Todo',
    schema: TODO_SCHEMA,
    operations: [
      { id: 'complete', label: 'Done', offered: (record) => record['done'] !== true },
      { id: 'reopen', label: 'Not done', offered: (record) => record['done'] === true },
    ],
    rows: {
      list: (query) => [...todos.values()].filter((row) => (query.filters['done'] ?? []).every((value) => String(row.record['done']) === value)),
      read: (id) => todos.get(id),
    },
    invoke: (operation, row, input) => {
      invoked.push(operation);
      if (operation === 'create') {
        next += 1;
        const id = `t-${String(next)}`;
        todos.set(id, { id, record: { done: false, ...input } });
        handle!.changed(undefined, id);
        return id;
      }
      if (operation === 'remove') todos.delete(row!.id);
      if (operation === 'complete') todos.set(row!.id, { ...row!, record: { ...row!.record, done: true } });
      handle!.changed(undefined, row!.id);
      return undefined;
    },
  });
  const { host: issuePlugin, contribution: issueContribution } = pluginHost('issues', context());
  issuePlugin.registerKind({
    channel: 'x-ahpd-todos',
    name: 'issue',
    title: 'Issue',
    schema: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'high'] } } },
    rows: {
      list: () => {
        if (options.issuesThrow === true) throw new Error('the tracker is down');
        return [{ id: 'i-1', record: { title: 'A broken build', priority: 'high' } }];
      },
      read: (id) => (id === 'i-1' ? { id: 'i-1', record: { title: 'A broken build', priority: 'high' } } : undefined),
    },
    invoke: () => undefined,
  });
  const folded = foldHostOptions({ path: root, agents: [] }, [todoContribution, issueContribution]);
  expect(folded.problems).toEqual([]);
  const channel = folded.options.channels!['x-ahpd-todos'] as ServedChannel;
  const sent: { uri: string; action: Record<string, unknown> }[] = [];
  const watching = new Set<string>();
  channel.publish = (uri, action) => { sent.push({ uri, action }); };
  channel.subscribers = (uri) => (watching.has(uri) ? [{ client: 'c1', reader: undefined }] : []);
  const subscribe = async (uri: string): Promise<Record<string, unknown>> => {
    const state = await channel.channel.snapshot(uri, undefined, 'c1') as Record<string, unknown>;
    watching.add(uri);
    return state;
  };
  const method = invokeOperation({
    channels: () => pluginOperationChannels(folded.options.channels),
    check: (value, schema) => {
      for (const field of (schema['required'] ?? []) as string[]) {
        if (typeof value !== 'object' || value === null || !(field in value)) throw new Error(`input needs ${field}`);
      }
    },
  });
  const invoke = (operationId: string, extra: Record<string, unknown> = {}) =>
    method.handle({ channel: 'x-ahpd-todos://', operationId, ...extra }, holding(['todo:put', 'todo:delete']), 'c1');
  /** Let the reads a changed starts settle. */
  const settle = async (): Promise<void> => { for (let n = 0; n < 5; n += 1) await Promise.resolve(); };
  return { folded, channel, subscribe, invoke, invoked, sent, settle, todos };
}

it('answers a snapshot with the rows of both kinds, in the default sort, each with its kind and operations', async () => {
  const { subscribe } = served();
  const state = await subscribe('x-ahpd-todos://');
  expect(state['records']).toEqual([
    { id: 'i-1', kind: 'issue', record: { title: 'A broken build', priority: 'high' }, operations: ['issue/update', 'issue/remove'] },
    { id: 't-milk', kind: 'todo', owner: 'user:ana', record: { title: 'Buy milk', done: false }, operations: ['todo/update', 'todo/remove', 'todo/complete'] },
    { id: 't-bob', kind: 'todo', owner: 'user:ana', record: { title: 'Call Bob', done: true }, operations: ['todo/update', 'todo/remove', 'todo/reopen'] },
  ]);
  expect(state['operations']).toEqual([{ id: 'todo/create', status: 'idle' }, { id: 'issue/create', status: 'idle' }]);
});

it('leaves out the rows of a kind with no done field while done is set, and refuses a filter the list does not declare', async () => {
  const { subscribe } = served();
  const state = await subscribe('x-ahpd-todos://?done=true');
  expect((state['records'] as { id: string }[]).map((one) => one.id)).toEqual(['t-bob']);
  await expect(subscribe('x-ahpd-todos://?colour=red')).rejects.toThrow(/no filter colour/);
  await expect(subscribe('x-ahpd-todos://?sort=priority')).rejects.toThrow(/sorts by title, not priority/);
});

it('answers the other kind\'s rows when one kind throws', async () => {
  const { subscribe, folded } = served({ issuesThrow: true });
  const state = await subscribe('x-ahpd-todos://');
  expect((state['records'] as { id: string }[]).map((one) => one.id)).toEqual(['t-milk', 't-bob']);
  expect(folded.problems).toEqual([]);
});

it('creates, completes and removes a todo through invoke, and tells each watched URI what it means there', async () => {
  const { subscribe, invoke, invoked, sent, settle } = served();
  await subscribe('x-ahpd-todos://');
  await subscribe('x-ahpd-todos://?done=false');

  const made = await invoke('todo/create', { input: { title: 'Water plants' } }) as Record<string, unknown>;
  expect(made).toMatchObject({ id: 't-1', kind: 'todo', record: { title: 'Water plants', done: false } });
  await settle();
  const added = sent.filter((one) => one.action['type'] === 'x-ahpd-todos/added').map((one) => one.uri);
  expect(added).toEqual(['x-ahpd-todos://', 'x-ahpd-todos://?done=false']);

  sent.length = 0;
  await invoke('todo/complete', { target: { id: 't-1' } });
  await settle();
  const last = (uri: string) => sent.filter((one) => one.uri === uri && one.action['id'] === 't-1').at(-1)?.action;
  expect(last('x-ahpd-todos://')).toMatchObject({ type: 'x-ahpd-todos/changed', record: { done: true }, operations: ['todo/update', 'todo/remove', 'todo/reopen'] });
  expect(last('x-ahpd-todos://?done=false')).toEqual({ type: 'x-ahpd-todos/removed', id: 't-1' });

  sent.length = 0;
  await invoke('todo/remove', { target: { id: 't-1' } });
  await settle();
  expect(last('x-ahpd-todos://')).toEqual({ type: 'x-ahpd-todos/removed', id: 't-1' });
  expect(invoked).toEqual(['create', 'complete', 'remove']);
});

it('refuses a create whose input breaks the schema, and calls no invoke', async () => {
  const { invoke, invoked } = served();
  await expect(invoke('todo/create', { input: {} })).rejects.toThrow('input needs title');
  expect(invoked).toEqual([]);
});

it('refuses an operation a row does not offer now', async () => {
  const { invoke } = served();
  await expect(invoke('todo/complete', { target: { id: 't-bob' } })).rejects.toThrow(/not offered on t-bob/);
});

it('reads one row at todo://<id>, from the kind that holds it', async () => {
  const { folded } = served();
  const provider = folded.options.resourceProviders!['todo']!;
  const read = await provider.read('todo://i-1');
  expect(JSON.parse(String(read.data))).toMatchObject({ id: 'i-1', kind: 'issue' });
  await expect(provider.read('todo://nothing')).rejects.toThrow();
});

it('asks todo:get of a subscriber, and lists the list\'s grants', () => {
  const { folded, channel } = served();
  expect(channel.channel.grant).toBe('todo:get');
  expect(folded.options.grants?.['todo']?.operations).toEqual(['get', 'put', 'delete']);
});
