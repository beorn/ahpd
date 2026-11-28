import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * #39198 / 39059 AC1, option A (@cto 871ffc8f, b8fa5918): the declaration owns the fact that a server needs a
 * person's token.
 *
 * A session whose record marks an entry seeds the wait at session start, so `awaiting()` names that resource before
 * the CLI has said anything and the customization is published as `authRequired`. A token then becomes that server's
 * header, and a second one replaces it. An unmarked entry keeps today's behaviour exactly: it waits for nothing until
 * the CLI reports `needs-auth` itself.
 *
 * At the pipe's tools server the CLI reports `connected` even with no token (it answers initialize 200), so a mark is
 * the only thing that can start the sign-in; without it the server is never in `wanted`, the host has nothing to aim
 * a client's token at, and a call is a 401 nobody can answer.
 */

const sdk = vi.hoisted(() => ({
  mcp: [] as Record<string, unknown>[],
  /** Each set of servers the session declared, in order. */
  declared: [] as Record<string, Bag>[],
  reconnected: [] as string[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => [],
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    let close = (): void => {};
    const closed = new Promise<void>((resolve) => { close = resolve; });
    return {
      async *[Symbol.asyncIterator]() {
        await prompt[Symbol.asyncIterator]().next();
        await closed;
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async (name: string) => {
        sdk.reconnected.push(name);
        const signed = (sdk.declared.at(-1)?.[name]?.headers as Record<string, unknown> | undefined)?.['Authorization'];
        if (signed !== undefined) sdk.mcp = [{ name, status: 'connected' }];
      },
      setMcpServers: async (servers: Record<string, Bag>) => { sdk.declared.push(structuredClone(servers)); },
      initializationResult: async () => ({}),
      mcpServerStatus: async () => sdk.mcp,
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close,
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 20); }); };

// A port nothing answers on: the wait names the entry's own URL as its resource, as the MCP authorization spec does.
const URL = 'http://127.0.0.1:1/mcp';
const header = (servers: Record<string, Bag> | undefined): unknown => (servers?.['docs']?.headers as Bag | undefined)?.['Authorization'];
const stateOf = (session: { customizations: () => Bag[] }): Bag | undefined =>
  (session.customizations() as Bag[]).find((one) => one['name'] === 'docs')?.['state'] as Bag | undefined;

const open = (entry: Bag) => {
  sdk.declared = [];
  sdk.reconnected = [];
  sdk.mcp = [];
  return createSession({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
    mcpServers: { docs: entry },
    emit: () => {},
  });
};

it('publishes authRequired with the marked entry resource before the CLI reports anything', async () => {
  const session = open({ type: 'http', url: URL, requiresClientToken: true });
  await settle();
  // The wait the host reads to know where to aim a client's token.
  expect(session.awaiting?.()).toEqual([URL]);
  const state = stateOf(session);
  expect(state?.['kind']).toBe('authRequired');
  expect(state?.['reason']).toBe('required');
  // The resource the host aims a client's token at, as the spec names it: the server's own URL.
  expect(JSON.stringify(state)).toContain(URL);
  await session.close();
});

it('takes the client token as that server header after the wait, and a re-aim replaces it', async () => {
  const session = open({ type: 'http', url: URL, requiresClientToken: true });
  await settle();
  expect(await session.authenticated?.(URL, 'first')).toBe(true);
  expect(header(sdk.declared.at(-1))).toBe('Bearer first');
  await settle();
  // Signed in, the server waits for nothing and its customization is the CLI's answer: connected.
  expect(session.awaiting?.()).toEqual([]);
  expect(stateOf(session)).toMatchObject({ kind: 'ready' });
  // A second token replaces the first rather than adding beside it.
  expect(await session.authenticated?.(URL, 'second')).toBe(true);
  expect(header(sdk.declared.at(-1))).toBe('Bearer second');
  expect(sdk.reconnected).toEqual(['docs', 'docs']);
  await session.close();
});

it('leaves an unmarked entry waiting for nothing, exactly as before', async () => {
  const session = open({ type: 'http', url: URL });
  await settle();
  expect(session.awaiting?.()).toEqual([]);
  expect(stateOf(session)?.['kind']).not.toBe('authRequired');
  await session.close();
});

it('shows a declared server the CLI never reported as stopped, never connected', async () => {
  // A declared entry exists before any CLI answer for it; a name the CLI never
  // reports must not read `ready`, which would be a connection this host cannot
  // see (@cto 10:22Z). Only a mark makes it wait; otherwise it is stopped.
  const session = open({ type: 'http', url: URL });
  await settle();
  expect(sdk.mcp).toEqual([]);
  expect(stateOf(session)?.['kind']).toBe('stopped');
  await session.close();
});
