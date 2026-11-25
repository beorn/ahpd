import { afterEach, describe, expect, it } from 'vitest';
import { echo } from '../../../examples/echo/agent.js';
import { posix } from '../../../tools/posix.ts';
import { ROOT } from '../src/host.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { hostTools } from '../src/tools/index.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Host } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import { root } from './users-gate-helpers.js';

const { createHost } = await import('../src/host.js');

/*
 * Which agents get the host's terminal tool.
 *
 * `enableCustomTerminalTool` is the reference's switch, off until the root
 * config turns it on. pi and cofold, the agents this host runs itself, get the
 * tool until the root config turns it off, because their own shells cannot
 * move to the background. A switch a client set either way wins for all.
 */

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

/** An echo agent under another provider's name, which keeps what it was handed. */
const named = (provider: string, starts: Map<string, Start>): Agent => {
  const base = { ...echo({ path: root, pace: 0 }), provider, displayName: provider };
  return { ...base, create: (start) => { starts.set(provider, start); return base.create(start); } };
};

/** The host tool names a session of each provider was handed, under a root config value or none. */
const handed = async (value?: boolean): Promise<Record<string, string[]>> => {
  const starts = new Map<string, Start>();
  const providers = ['pi', 'cofold', 'claude', 'acp'];
  const host = createHost({
    path: root,
    agents: providers.map((one) => named(one, starts)),
    terminals: shellTerminals(),
    tools: hostTools(),
  });
  opened.push(host);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { channel: ROOT, clientId: 'shells', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  if (value !== undefined) {
    await client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config: { enableCustomTerminalTool: value } } } });
  }
  for (const provider of providers) {
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${provider}`, provider } });
  }
  return Object.fromEntries(providers.map((one) => [one, (starts.get(one)?.tools ?? []).map((tool) => tool.definition.name)]));
};

describe('the host terminal tool, by provider', () => {
  it.skipIf(!posix)('goes to pi and cofold while the switch is unset, and to nobody else', async () => {
    const names = await handed();
    expect(names.pi).toContain('bash');
    expect(names.cofold).toContain('bash');
    expect(names.claude).not.toContain('bash');
    expect(names.acp).not.toContain('bash');
  });

  it('goes to nobody when the switch is off', async () => {
    const names = await handed(false);
    for (const one of Object.values(names)) expect(one).not.toContain('bash');
  });

  it.skipIf(!posix)('goes to everybody when the switch is on', async () => {
    const names = await handed(true);
    for (const one of Object.values(names)) expect(one).toContain('bash');
  });
});
