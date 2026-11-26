import { loggerOf } from '../src/log.js';
import { describe, expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import type { PluginHost } from '../src/types/plugin.js';
import { sdkVersion } from '../src/version.js';
import type { ListDeclaration, ListKind } from '../src/types/lists.js';
import type { LoaderContext } from '../src/types/plugin.js';

const context = (): LoaderContext => ({
  path: '/tmp/lists',
  paths: ['/tmp/lists'],
  version: sdkVersion(),
  hostName: 'test',
  configDir: '/tmp/lists',
  log: loggerOf(() => {}),
  say: () => {},
});

/** The todo list of the todo brief. */
export const todoList = (over: Partial<ListDeclaration> = {}): ListDeclaration => ({
  name: 'todo',
  channel: 'x-ahpd-todos',
  title: 'Todos',
  description: 'Things to do.',
  filters: [{ field: 'done', type: 'boolean' }],
  search: ['title'],
  sorts: ['title'],
  defaultSort: 'title',
  ...over,
});

/** A todo kind with no rows. */
export const todoKind = (over: Partial<ListKind> = {}): ListKind => ({
  channel: 'x-ahpd-todos',
  name: 'todo',
  title: 'Todo',
  description: 'One thing to do.',
  schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' }, done: { type: 'boolean' } } },
  operations: [{ id: 'complete', label: 'Done' }],
  rows: { list: () => [], read: () => undefined },
  invoke: () => undefined,
  ...over,
});

describe('registerList', () => {
  it('records a complete list in the plugin\'s contribution', () => {
    const { host, contribution } = pluginHost('alpha', context(), { contracts: { lists: ['todo'] } });
    host.registerList(todoList({ channel: 'X-AHPD-Todos' }));
    expect(contribution.lists?.['todo']).toMatchObject({ name: 'todo', channel: 'x-ahpd-todos', title: 'Todos', by: 'alpha' });
  });

  it('refuses an empty object, naming what is missing', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerList({} as never)).toThrow(/alpha.*registerList.*name/);
  });

  it('refuses instances and a page, naming the step that builds each', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerList(todoList({ instances: true }))).toThrow(/registerList.*instances.*later step/);
    expect(() => host.registerList(todoList({ page: { size: 50 } }))).toThrow(/registerList.*page.*merged cursor/);
  });

  it('refuses a range or uri filter, naming the step that builds it', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerList(todoList({ filters: [{ field: 'createdAt', type: 'range' }] }))).toThrow(/filter createdAt.*range waits/);
    expect(() => host.registerList(todoList({ filters: [{ field: 'client', type: 'uri', channel: 'x-ahpd-clients' }] }))).toThrow(/filter client.*uri waits/);
    expect(() => host.registerList(todoList({ filters: [{ field: 'done', type: 'colour' as never }] }))).toThrow(/filter done type/);
  });

  it('refuses a defaultSort that is not one of the sorts, with or without -', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerList(todoList({ defaultSort: '-createdAt' }))).toThrow(/registerList.*defaultSort/);
    expect(() => host.registerList(todoList({ name: 'todo-a', defaultSort: '-title' }))).not.toThrow();
  });

  it('refuses a channel that is not an extension scheme, and a name the host uses', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerList(todoList({ channel: 'todos' }))).toThrow(/registerList.*todos.*x-/);
    expect(() => host.registerList(todoList({ name: 'file' }))).toThrow(/registerList.*file.*host does not use/);
  });

  it('refuses a name the contracts do not list, and a second list of one name in one plugin', () => {
    expect(() => pluginHost('alpha', context(), { contracts: { lists: ['note'] } }).host.registerList(todoList())).toThrow(/alpha.*lists.*todo/);
    const { host } = pluginHost('alpha', context());
    host.registerList(todoList());
    expect(() => host.registerList(todoList())).toThrow(/registerList.*todo.*no other list/);
  });
});

describe('registerKind', () => {
  it('records a complete kind in the plugin\'s contribution, keyed by its channel and name', () => {
    const { host, contribution } = pluginHost('alpha', context(), { contracts: { kinds: ['todo'] } });
    host.registerKind(todoKind());
    expect(contribution.kinds?.['x-ahpd-todos todo']).toMatchObject({ name: 'todo', channel: 'x-ahpd-todos', by: 'alpha' });
  });

  it('refuses an empty object, naming what is missing', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerKind({} as never)).toThrow(/alpha.*registerKind.*channel/);
  });

  it('refuses a kind with no rows or no invoke, and a runtime class', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerKind(todoKind({ rows: { list: () => [] } as never }))).toThrow(/registerKind.*rows\.read/);
    expect(() => host.registerKind(todoKind({ invoke: undefined as never }))).toThrow(/registerKind.*invoke/);
    expect(() => host.registerKind(todoKind({ class: 'runtime' }))).toThrow(/registerKind.*class.*later step/);
  });

  it('refuses an operation the host serves for every kind, and a relation with neither one nor many', () => {
    const { host } = pluginHost('alpha', context());
    expect(() => host.registerKind(todoKind({ operations: [{ id: 'update' }] }))).toThrow(/registerKind.*operation update/);
    expect(() => host.registerKind(todoKind({ relations: { client: { channel: 'x-ahpd-clients' } } }))).toThrow(/registerKind.*relation client/);
  });

  it('refuses a name the contracts do not list, and a second kind of one name on one channel', () => {
    expect(() => pluginHost('alpha', context(), { contracts: { kinds: ['note'] } }).host.registerKind(todoKind())).toThrow(/alpha.*kinds.*todo/);
    const { host } = pluginHost('alpha', context());
    host.registerKind(todoKind());
    expect(() => host.registerKind(todoKind())).toThrow(/registerKind.*todo.*no other kind/);
    expect(() => host.registerKind(todoKind({ channel: 'x-ahpd-notes' }))).not.toThrow();
  });

  it('refuses a changed said before a host is built over the plugin', () => {
    const { host } = pluginHost('alpha', context());
    const handle = host.registerKind(todoKind());
    expect(() => handle.changed(undefined, 't-1')).toThrow(/changed.*t-1.*once a host is built/);
  });
});

/** The contribution of a plugin that ran `register`. */
const plugin = (by: string, register: (host: PluginHost) => void) => {
  const { host, contribution } = pluginHost(by, context());
  register(host);
  return contribution;
};

const fold = (...contributions: ReturnType<typeof plugin>[]) => foldHostOptions({ path: '/tmp/lists', agents: [] }, contributions);

describe('the fold of lists', () => {
  it('joins two declarations of one list, with both filters and the first words', () => {
    const { options, problems } = fold(
      plugin('alpha', (host) => host.registerList(todoList())),
      plugin('beta', (host) => host.registerList(todoList({ filters: [{ field: 'priority', type: 'enum' }], sorts: ['priority'], defaultSort: 'priority' }))),
    );
    expect(problems).toEqual([]);
    expect(options.lists?.['todo']).toMatchObject({
      by: 'alpha',
      declaredBy: ['alpha', 'beta'],
      channel: 'x-ahpd-todos',
      title: 'Todos',
      filters: [{ field: 'done', type: 'boolean' }, { field: 'priority', type: 'enum' }],
      sorts: ['title', 'priority'],
      defaultSort: 'title',
    });
  });

  it('reports a declaration on another channel or with other words, and keeps the first', () => {
    const { options, problems } = fold(
      plugin('alpha', (host) => host.registerList(todoList())),
      plugin('beta', (host) => host.registerList(todoList({ channel: 'x-ahpd-tasks', title: 'Tasks' }))),
    );
    expect(problems).toEqual([
      'plugin beta declares list todo on x-ahpd-tasks, and plugin alpha declared it on x-ahpd-todos; x-ahpd-todos stays',
      "plugin beta declares list todo with another title; plugin alpha's stays",
    ]);
    expect(options.lists?.['todo']).toMatchObject({ channel: 'x-ahpd-todos', title: 'Todos' });
  });

  it('refuses a list on a scheme a channel took first, and a channel on a list\'s scheme', () => {
    const channel = (by: string) => plugin(by, (host) => {
      host.registerChannel('x-ahpd-todos', { grant: 'todo:get', snapshot: () => ({}) });
    });
    const first = fold(channel('alpha'), plugin('beta', (host) => host.registerList(todoList())));
    // The refused list adds no grants, so the channel's own grant is reported as unlisted too.
    expect(first.problems).toContain('plugin beta declares list todo on x-ahpd-todos, which plugin alpha already registered as a channel; the list is refused');
    expect(first.options.lists).toBeUndefined();
    expect(first.options.channels?.['x-ahpd-todos']).toBeDefined();

    const second = fold(plugin('alpha', (host) => host.registerList(todoList())), channel('beta'));
    expect(second.problems).toEqual(['plugin beta registers channel x-ahpd-todos, which plugin alpha already declared as list todo; the channel is refused']);
    expect(second.options.lists?.['todo']).toBeDefined();
    // The scheme is the list's own channel now, and beta's is gone.
    expect(second.options.channels?.['x-ahpd-todos']?.by).toBe('alpha');
    expect(second.options.channels?.['x-ahpd-todos']?.channel.grant).toBe('todo:get');
  });

  it('attaches each kind to the list its channel names, from any plugin', () => {
    const { options, problems } = fold(
      plugin('alpha', (host) => { host.registerList(todoList()); host.registerKind(todoKind()); }),
      plugin('beta', (host) => { host.registerKind(todoKind({ name: 'issue', title: 'Issue' })); }),
    );
    expect(problems).toEqual([]);
    expect(Object.keys(options.lists?.['todo']?.kinds ?? {})).toEqual(['todo', 'issue']);
    expect(options.lists?.['todo']?.kinds['issue']?.by).toBe('beta');
  });

  it('reports a kind on a list nobody declared, and a second kind of one name in a list', () => {
    const lone = fold(plugin('alpha', (host) => { host.registerKind(todoKind()); }));
    expect(lone.problems).toEqual(['plugin alpha adds kind todo to x-ahpd-todos, which no plugin declared as a list; the kind is left out']);
    expect(lone.options.lists).toBeUndefined();

    const twice = fold(
      plugin('alpha', (host) => { host.registerList(todoList()); host.registerKind(todoKind()); }),
      plugin('beta', (host) => { host.registerKind(todoKind()); }),
    );
    expect(twice.problems).toEqual(['plugin beta adds kind todo to list todo, which plugin alpha already added; the first stays']);
    expect(twice.options.lists?.['todo']?.kinds['todo']?.by).toBe('alpha');
  });

  it('adds the list\'s get, put and delete grants', () => {
    const { options } = fold(plugin('alpha', (host) => host.registerList(todoList())));
    expect(options.grants?.['todo']).toEqual({ title: 'Todos', description: 'Things to do.', operations: ['get', 'put', 'delete'] });
  });
});
