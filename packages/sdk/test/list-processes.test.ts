import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { invokeOperation, pluginOperationChannels } from '../src/kinds/operations.js';
import { PROCESS_STOP, PROCESSES, PROCESSES_SCHEME } from '../src/lists/processes.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { ListKindHandle, ListProcess, ListRow } from '../src/types/lists.js';
import type { LoaderContext, ServedChannel } from '../src/types/plugin.js';
import type { Principal } from '../src/types/users.js';

/*
 * Processes: a services list whose kind deploys a service with a long
 * operation. The deploy runs as a process the kind keeps in memory, and a CI
 * job the kind answers was never run by the host. The channels are driven as
 * the host drives them, with `publish` and `subscribers` set by hand.
 */

const root = '/nonexistent-list-processes';
const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });
const holding = (grants: string[]): Principal => ({ id: 'ana', roles: [], can: (grant: string) => grants.includes(grant) });

/** The deploy plugin: a services list, one service, and a deploy that waits for `release` to end. */
function served() {
  const kept = new Map<string, ListProcess>([
    ['ci-1', { id: 'ci-1', title: 'CI build', lifecycle: 'running', startedAt: '2026-11-26T01:00:00Z' }],
  ]);
  const stoppedByKind: string[] = [];
  let release: () => void = () => {};
  let fail = false;
  let handle: ListKindHandle | undefined;
  const { host, contribution } = pluginHost('deploys', context());
  host.registerList({ name: 'service', channel: 'x-ahpd-services', title: 'Services' });
  const rows: ListRow[] = [{ id: 'web', record: { name: 'web' } }];
  handle = host.registerKind({
    channel: 'x-ahpd-services',
    name: 'compose',
    title: 'process-compose',
    schema: { type: 'object', properties: { name: { type: 'string' } } },
    operations: [{ id: 'deploy', label: 'Deploy', long: true, grant: 'service:deploy' }],
    rows: { list: () => rows, read: (id) => rows.find((one) => one.id === id) },
    processes: {
      list: () => [...kept.values()],
      read: (id) => kept.get(id),
      stop: (id) => { stoppedByKind.push(id); },
    },
    invoke: async (operation, row, _input, work) => {
      if (operation !== 'deploy' || work === undefined) return undefined;
      kept.set(work.id, { id: work.id, title: `Deploy ${row!.id}`, origin: { row: row!.id, operation: 'deploy' }, lifecycle: 'running', startedAt: '2026-11-26T02:00:00Z' });
      handle!.processChanged(work.id);
      work.report({ progress: 0.5, line: 'built' });
      await new Promise<void>((done) => {
        release = done;
        work.signal.addEventListener('abort', () => { done(); });
      });
      if (fail) throw new Error('the check failed');
      kept.set(work.id, { ...kept.get(work.id)!, lifecycle: work.signal.aborted ? 'stopped' : 'completed' });
      handle!.processChanged(work.id);
      return undefined;
    },
  });
  host.registerGrants('service', { operations: ['deploy'] });
  const folded = foldHostOptions({ path: root, agents: [], grants: { operation: { operations: ['invoke'] } } }, [contribution]);
  expect(folded.problems).toEqual([]);
  const channel = folded.options.channels![PROCESSES_SCHEME] as ServedChannel;
  const sent: { uri: string; action: Record<string, unknown> }[] = [];
  channel.publish = (uri, action) => { sent.push({ uri, action }); };
  channel.subscribers = () => [];
  const method = invokeOperation({ channels: () => pluginOperationChannels(folded.options.channels), check: () => {} });
  const deploy = () => method.handle({ channel: 'x-ahpd-services://', operationId: 'compose/deploy', target: { id: 'web' } }, holding(['service:deploy']), 'c1') as Promise<{ process: string }>;
  const stop = folded.options.methods![PROCESS_STOP]!.method;
  const settle = async (): Promise<void> => { for (let n = 0; n < 10; n += 1) await Promise.resolve(); };
  return { folded, channel, sent, deploy, stop, settle, kept, stoppedByKind, finish: (failing = false) => { fail = failing; release(); } };
}

it('answers a long call with its process at once, and relays its reports until it completes', async () => {
  const { deploy, sent, settle, finish, channel } = served();
  const { process } = await deploy();
  expect(process).toMatch(/^x-ahpd-processes:\/\/service\/compose\/[0-9a-f-]+$/);
  await settle();
  const reported = () => sent.filter((one) => one.uri === process && one.action['type'] === `${PROCESSES_SCHEME}/reported`).map((one) => one.action);
  expect(reported()).toEqual([
    { type: 'x-ahpd-processes/reported', lifecycle: 'running' },
    { type: 'x-ahpd-processes/reported', progress: 0.5, line: 'built' },
  ]);
  // The kind keeps the process, so a read answers it while it runs.
  expect(await channel.channel.snapshot(process, undefined, 'c1')).toMatchObject({ process: { uri: process, list: 'service', kind: 'compose', lifecycle: 'running', origin: { row: 'web', operation: 'deploy' } } });

  finish();
  await settle();
  expect(reported().at(-1)).toEqual({ type: 'x-ahpd-processes/reported', lifecycle: 'completed' });
  expect(sent.filter((one) => one.uri === PROCESSES && one.action['type'] === `${PROCESSES_SCHEME}/changed`).at(-1)?.action).toMatchObject({ process: { lifecycle: 'completed' } });
});

it('reports a process whose work throws as failed', async () => {
  const { deploy, sent, settle, finish } = served();
  const { process } = await deploy();
  await settle();
  finish(true);
  await settle();
  expect(sent.filter((one) => one.uri === process).at(-1)?.action).toEqual({ type: 'x-ahpd-processes/reported', lifecycle: 'failed', error: 'the check failed' });
});

it('stops a process the host runs by its signal, and asks the kind to stop one it does not', async () => {
  const { deploy, sent, settle, stop, stoppedByKind } = served();
  const { process } = await deploy();
  await settle();
  expect(await stop.handle({ process }, holding(['service:deploy']), 'c1')).toEqual({});
  await settle();
  expect(sent.filter((one) => one.uri === process).at(-1)?.action).toEqual({ type: 'x-ahpd-processes/reported', lifecycle: 'stopped' });

  expect(await stop.handle({ process: 'x-ahpd-processes://service/compose/ci-1' }, holding(['service:put']), 'c1')).toEqual({});
  expect(stoppedByKind).toEqual(['ci-1']);
});

it('refuses a stop to a reader without the grant of the operation that started it', async () => {
  const { deploy, settle, stop } = served();
  const { process } = await deploy();
  await settle();
  await expect(stop.handle({ process }, holding(['service:put']), 'c1')).rejects.toThrow(/needs service:deploy/);
});

it('lists every process at the root, newest first, and a finished one still reads from the kind', async () => {
  const { deploy, settle, finish, channel } = served();
  const { process } = await deploy();
  await settle();
  finish();
  await settle();
  const state = await channel.channel.snapshot(PROCESSES, undefined, 'c1') as { processes: { uri: string; lifecycle: string }[] };
  expect(state.processes.map((one) => one.uri)).toEqual([process, 'x-ahpd-processes://service/compose/ci-1']);
  expect(state.processes[0]?.lifecycle).toBe('completed');
});

it('lets a reader of the list read its processes, and refuses a kind with a long operation and no processes', async () => {
  const { channel } = served();
  expect(await channel.channel.authorize!('x-ahpd-processes://service/compose/ci-1', holding(['service:get']))).toBe(true);
  expect(await channel.channel.authorize!('x-ahpd-processes://service/compose/ci-1', holding(['todo:get']))).toBe(false);
  const { host } = pluginHost('bad', context());
  expect(() => host.registerKind({
    channel: 'x-ahpd-services', name: 'bad', title: 'Bad', schema: { type: 'object' },
    operations: [{ id: 'go', long: true }], rows: { list: () => [], read: () => undefined }, invoke: () => undefined,
  })).toThrow(/registerKind.*processes/);
});
