/*
 * #38506: a plugin's agent whose sessions have no `close`.
 *
 * A JS plugin is not type-checked, and `registerAgent` checks the agent, never
 * the session its `create` answers. The live probe plugins (probe-agent,
 * narrow-a) answered sessions without `close`, and on such a chat
 * `disposeSession` threw "chat.close is not a function" half way through the
 * removal, and stopping the host logged that failure for every chat. A chat
 * with no `close` holds nothing to close, so the host lets go of it as closed
 * and says once, by chat and provider, that the backend left `close` out.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { loggerOf } from '../src/log.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-plugin-no-close-'));

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

const peer = (): Peer => ({
  name: 'client', send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
}) as unknown as Peer;

/** A plugin agent shaped like the probe plugins: every session member but `close`. */
const closeless = (): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider: 'closeless',
    displayName: 'Closeless',
    create: (start) => {
      const { close: _left, ...rest } = base.create(start) as unknown as Record<string, unknown>;
      return rest as never;
    },
  };
};
/** A host over one plugin, `probe`, whose agent is the closeless one, with its log kept. */
async function hosting() {
  const said: string[] = [];
  const { host: plugin, contribution } = pluginHost('probe', context(), { grants: [] });
  plugin.registerAgent(closeless());
  const { options } = foldHostOptions({ path: DIR, agents: [], sessions: memorySessions(), onEvent: (line: string) => { said.push(line); } }, [contribution]);
  const host = createHost(options);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'closeless:/one', provider: 'closeless' } });
  await client.handle({ method: 'createSession', params: { channel: 'closeless:/two', provider: 'closeless' } });
  return { said, host, client };
}

/** What the host said about a backend that left `close` out: one line a chat, by chat and provider. */
const told = (said: string[]): string[] => said.filter((line) => /without close/.test(line));

it('disposes a session whose plugin agent made its chat without close', async () => {
  const { said, host, client } = await hosting();
  // The removal finishes rather than answering -32603 half way through it.
  await expect(client.handle({ method: 'disposeSession', params: { channel: 'closeless:/one' } })).resolves.toBeDefined();
  // Gone, and the other session still there.
  await expect(client.handle({ method: 'subscribe', params: { channel: 'closeless:/one' } })).rejects.toThrow();
  await expect(client.handle({ method: 'subscribe', params: { channel: 'closeless:/two' } })).resolves.toBeDefined();
  expect(told(said)).toHaveLength(2);
  for (const line of told(said)) expect(line).toMatch(/^ahp-chat:\/\S+: agent closeless made a session without close/);
  await host.close();
  client.close();
});

it('stops a host whose open chats were made by a plugin agent without close', async () => {
  const { said, host, client } = await hosting();
  await host.close();
  client.close();
  // Each chat let go of as closed, never "closing ... failed: chat.close is not a function".
  expect(said.filter((line) => /is not a function/.test(line))).toEqual([]);
  expect(told(said)).toHaveLength(2);
});
