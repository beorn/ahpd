import { beforeEach, expect, it } from 'vitest';
import { loggerOf } from '../src/log.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { uriOf } from '../src/resources/fileuri.js';
import { echo, hostTools, machine, settle } from './support/host.js';
import { directory, hello, peer, signIn } from './users-gate-helpers.js';
import { WORK } from './support/work.js';
import type { Agent } from '../src/types/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';

/*
 * The agent of a create that names none: the one the root config's
 * `defaultAgent` names, else the first that is on, may be used and whose
 * program is found. One rule for a client's create, the form it draws first,
 * a plugin's session and a plugin's chat.
 */

const ROOT = 'ahp-root://';
const context = (): LoaderContext => ({
  path: WORK, paths: [WORK], version: sdkVersion(), hostName: 'test', configDir: WORK, log: loggerOf(() => {}), say: () => {},
});

/** Every agent a chat was started on, in order, across one case. */
const order: string[] = [];
beforeEach(() => { order.length = 0; });

/** An echo backend under a name of its own, whose program may be missing, with one key of its own. */
const named = (provider: string, missing?: string): Agent => {
  const base = echo({ path: WORK, pace: 0 });
  return {
    ...base,
    provider,
    displayName: provider.toUpperCase(),
    schema: () => ({ type: 'object', properties: { [`${provider}-key`]: { type: 'string', title: provider } } }),
    create: (start) => { order.push(provider); return base.create(start); },
    ...(missing === undefined ? {} : { missingProgram: () => missing }),
  };
};

const made = async (agents: Agent[], over: Partial<HostOptions> = {}) => {
  const { host: plugin, contribution } = pluginHost('bots', context());
  plugin.registerAgent(named('front'));
  const { options } = foldHostOptions({ path: WORK, agents, ...machine(), sessions: memorySessions(), ...over } as HostOptions, [contribution]);
  const host = createHost(options);
  contribution.connects.host = host;
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'one', protocolVersions: ['1.1.0'], initialSubscriptions: [ROOT] } });
  return { host, client, plugin };
};
type Client = Awaited<ReturnType<typeof made>>['client'];

const choose = async (client: Client, provider: string): Promise<void> => {
  await client.handle({ method: 'dispatchAction', params: { channel: ROOT, clientSeq: 1, action: { type: 'root/configChanged', config: { defaultAgent: provider } } } });
};
const root = async (client: Client) =>
  (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, { enum?: string[]; enumLabels?: string[] }> } } } };
  }).snapshot.state;
/** The agent each entry point takes when it names none. */
let count = 0;
const created = async (client: Client): Promise<unknown> => {
  count += 1;
  const channel = `ahp-session:/s${count}`;
  await client.handle({ method: 'createSession', params: { channel } });
  return order.at(-1);
};
const formOf = async (client: Client): Promise<string[]> => {
  const answer = await client.handle({ method: 'resolveSessionConfig', params: { channel: ROOT } }) as { schema: { properties: Record<string, unknown> } };
  return Object.keys(answer.schema.properties).filter((key) => key.endsWith('-key'));
};

it('passes over an agent whose program is missing, in the create and in the form', async () => {
  const { client } = await made([named('amp', 'amp-acp'), named('claude')]);
  expect(await created(client)).toBe('claude');
  expect(await formOf(client)).toEqual(['claude-key']);
});

it('takes the first agent that is on where every program is missing', async () => {
  const { client } = await made([named('off'), named('amp', 'amp-acp'), named('front2', 'x')], { disabledAgents: () => new Set(['off', 'front']) });
  expect(await created(client)).toBe('amp');
});

it('passes over an agent that is off or paused', async () => {
  const { client } = await made([named('a'), named('b'), named('c')], { disabledAgents: () => new Set(['a']), pausedAgents: () => new Set(['b']) });
  expect(await created(client)).toBe('c');
});

it('says nothing of a missing program for a create on a computer', async () => {
  const { client } = await made([named('amp', 'amp-acp'), named('claude')]);
  const answer = await client.handle({ method: 'resolveSessionConfig', params: { channel: ROOT, config: { computer: 'computer://one' } } }) as { schema: { properties: Record<string, unknown> } };
  expect(Object.keys(answer.schema.properties)).toContain('amp-key');
});

it('takes the agent the setting names, though its program is missing', async () => {
  const { client } = await made([named('claude'), named('amp', 'amp-acp')]);
  await choose(client, 'amp');
  expect(await created(client)).toBe('amp');
  expect(await formOf(client)).toEqual(['amp-key']);
  await choose(client, '');
  expect(await created(client)).toBe('claude');
});

it('refuses a create whose chosen agent is off, paused or not served', async () => {
  const off = new Set(['a']);
  const { client } = await made([named('a'), named('b'), named('c')], { disabledAgents: () => off, pausedAgents: () => new Set(['b']) });
  const create = (channel: string): Promise<unknown> => client.handle({ method: 'createSession', params: { channel } });
  await choose(client, 'a');
  await expect(create('ahp-session:/r1')).rejects.toThrow('a is turned off.');
  await choose(client, 'b');
  await expect(create('ahp-session:/r2')).rejects.toThrow('b is paused.');
  await choose(client, 'gone');
  await expect(create('ahp-session:/r3')).rejects.toThrow('No agent provider registered for: gone');
});

it('passes over an agent the caller may not use, and refuses a chosen one', async () => {
  const { host } = await made([named('hers'), named('all')], {
    users: directory({ soft: ['session:*', 'config:change', 'config:read'] }),
    agentOwners: () => new Map([['hers', 'user:ana' as const]]),
  });
  const client = host.accept(peer());
  await hello(client, 'soft');
  await signIn(client, 'soft');
  expect(await created(client)).toBe('all');
  await choose(client, 'hers');
  await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/no' } })).rejects.toThrow('No agent provider registered for: hers');
});

it('starts a plugin session on the default', async () => {
  const { client, plugin } = await made([named('amp', 'amp-acp'), named('claude'), named('pi')]);
  await plugin.startSession({ owner: 'root:test', workingDirectory: uriOf(WORK), prompt: 'hi' });
  await choose(client, 'pi');
  await plugin.startSession({ owner: 'root:test', workingDirectory: uriOf(WORK), prompt: 'hi' });
  await settle(8);
  expect(order).toEqual(['claude', 'pi']);
});

it('runs a plugin chat on the default, and never on an agent of that plugin', async () => {
  const { client, plugin } = await made([named('amp', 'amp-acp'), named('claude'), named('pi')]);
  const session = 'ahp-session:/talk';
  await client.handle({ method: 'createSession', params: { channel: session, provider: 'front' } });
  await plugin.startChat(session, {});
  await choose(client, 'pi');
  await plugin.startChat(session, {});
  await choose(client, 'front');
  await plugin.startChat(session, {});
  expect(order).toEqual(['front', 'claude', 'pi', 'claude']);
});

it('offers the agents as the setting\'s choices, and keeps a chosen one it does not serve', async () => {
  const { client } = await made([named('a'), named('b')]);
  const choices = async () => (await root(client)).config.schema.properties['defaultAgent'];
  expect(await choices()).toMatchObject({ enum: ['', 'a', 'b', 'front'], enumLabels: ['First agent found', 'A', 'B', 'FRONT'] });
  await choose(client, 'gone');
  expect((await choices())?.enum).toEqual(['', 'a', 'b', 'front', 'gone']);
});

it('restores the setting when its agent is not served at the start', async () => {
  const store = { read: () => ({ defaultAgent: 'late' }), write: () => {} };
  const { client } = await made([named('a')], { rootConfigStore: store as never });
  await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/late' } })).rejects.toThrow('No agent provider registered for: late');
});

it('runs a create_session tool call with no session on the default', async () => {
  const { host, client } = await made([named('amp', 'amp-acp'), named('claude'), named('pi')], { tools: hostTools() });
  const create = async (): Promise<unknown> => await host.sessionlessTools({ root: true })
    .find((one) => one.definition.name === 'create_session')?.run?.({ relationship: 'independent', title: 'One', prompt: 'hi', workspace: WORK });
  await create();
  await choose(client, 'pi');
  await create();
  expect(order).toEqual(['claude', 'pi']);
});
