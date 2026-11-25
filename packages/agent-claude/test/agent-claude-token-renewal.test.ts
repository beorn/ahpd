import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A token for an MCP server, and its renewal.
 *
 * The first token reaches a server the CLI says needs signing in. A renewal
 * for the same resource arrives while the server is connected on the token it
 * renews, and is applied then, not after the old token runs out and the server
 * asks again.
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
      // A server reconnected with a token comes back connected; without one it still needs signing in.
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

// A port nothing answers on, so the sign-in's metadata is the bare resource.
const URL = 'http://127.0.0.1:1/mcp';
const header = (servers: Record<string, Bag> | undefined): unknown => (servers?.['docs']?.headers as Bag | undefined)?.['Authorization'];

async function signedIn() {
  sdk.declared = [];
  sdk.reconnected = [];
  sdk.mcp = [{ name: 'docs', status: 'connected' }];
  const session = createSession({
    uri: 'ahp-session:/renew',
    chatUri: 'ahp-chat:/renew',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-renew-')),
    mcpServers: { docs: { type: 'http', url: URL } },
    emit: () => {},
  });
  await settle();
  session.sendMessage('t1', 'go');
  await settle();
  // The CLI says the server needs signing in, as a 401 makes it.
  sdk.mcp = [{ name: 'docs', status: 'needs-auth', config: { type: 'http', url: URL } }];
  await session.startMcpServer?.('claude-internal:/mcp/docs#mcp=docs');
  await settle();
  // Only the reconnects a token makes are counted below.
  sdk.reconnected = [];
  return session;
}

it('applies a first token to the server that asked, then a renewal on arrival', async () => {
  const session = await signedIn();
  expect(session.awaiting?.()).toEqual([URL]);

  expect(await session.authenticated?.(URL, 'first')).toBe(true);
  expect(header(sdk.declared.at(-1))).toBe('Bearer first');
  await settle();
  // Signed in, the server waits for nothing.
  expect(session.awaiting?.()).toEqual([]);

  // The renewal, while the server still runs on the first token.
  expect(await session.authenticated?.(URL, 'second')).toBe(true);
  expect(header(sdk.declared.at(-1))).toBe('Bearer second');
  expect(sdk.reconnected).toEqual(['docs', 'docs']);
  await session.close();
});

it('takes no token for a resource no server of the session signed into', async () => {
  const session = await signedIn();
  expect(await session.authenticated?.('http://127.0.0.1:2/other', 'stray')).toBe(false);
  await session.authenticated?.(URL, 'first');
  expect(await session.authenticated?.('http://127.0.0.1:2/other', 'stray')).toBe(false);
  expect(sdk.declared.map(header)).toEqual(['Bearer first']);
  await session.close();
});
