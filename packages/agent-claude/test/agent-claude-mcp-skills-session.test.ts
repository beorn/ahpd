import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A Claude session whose MCP server serves a skill: its CLI starts with the
 * folder the skill lands in, the server's row lists it once, and a switch by
 * its id has the CLI read the folder again.
 */

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], reloads: 0, status: 'connected' }));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { options: Record<string, unknown> }) => {
    sdk.options.push(given.options);
    return {
      async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
      interrupt: async () => {}, setPermissionMode: async () => {}, setModel: async () => {}, applyFlagSettings: async () => {},
      toggleMcpServer: async () => {}, reconnectMcpServer: async () => {}, setMcpServers: async () => {},
      initializationResult: async () => ({ models: [], agents: [], commands: [{ name: 'mcp-skills:refunds', description: 'x' }] }),
      mcpServerStatus: async () => [{ name: 'desk', status: sdk.status }],
      reloadSkills: async () => ({ skills: [{ name: 'mcp-skills:refunds', description: 'x' }] }),
      reloadPlugins: async () => {
        sdk.reloads += 1;
        return { plugins: ((given.options.plugins ?? []) as { path: string }[]).map((one) => ({ name: 'mcp-skills', path: one.path })), commands: [], agents: [] };
      },
      supportedModels: async () => [], streamInput: async () => {}, close: () => {},
    };
  },
}));

const TEXT = 'Refund.';
vi.mock('@cofold/mcp-client', () => ({
  expandServer: (server: unknown) => server,
  connectMcp: async () => ({
    servesSkills: true,
    skills: async () => [{
      uri: 'skill://refunds/SKILL.md',
      frontmatter: { name: 'refunds', description: 'Refunds' },
      resources: [{ uri: 'skill://refunds/SKILL.md', digest: `sha256:${createHash('sha256').update(TEXT).digest('hex')}`, size: TEXT.length }],
    }],
    read: async (uri: string) => [{ uri, text: TEXT }],
    close: async () => {},
  }),
}));

const { createSession } = await import('../src/session.js');

beforeEach(() => { sdk.options = []; sdk.reloads = 0; sdk.status = 'connected'; });

const opened = async (over: Bag = {}) => {
  const said: Bag[] = [];
  let handshook = (): void => {};
  const shook = new Promise<void>((done) => { handshook = done; });
  const session = createSession({
    uri: `ahp-session:/${crypto.randomUUID()}`, chatUri: 'ahp-chat:/mcp-skills', cwd: mkdtempSync(join(tmpdir(), 'ahpd-mcp-skills-test-')),
    emit: (_channel: string, action: Bag) => { said.push(action); },
    mcpServers: { desk: { type: 'http', url: 'https://desk.example/mcp' } },
    onHandshake: () => { handshook(); },
    ...over,
  } as never);
  session.sendMessage('t1', 'hello');
  await shook;
  const folder = (): string | undefined => (sdk.options.at(-1)?.plugins as { path: string }[] | undefined)?.at(-1)?.path;
  const desk = (): Bag | undefined => (session.customizations() as Bag[]).find((one) => one.name === 'desk');
  return { session, said, folder, desk };
};

it('lists the skill under its server alone, loads it, and switches it by its id', async () => {
  const { session, said, folder, desk } = await opened();
  await vi.waitFor(() => { expect(desk()?.children).toHaveLength(1); });
  const child = (desk()?.children as Bag[])[0] as Bag;
  expect(child).toMatchObject({ type: 'skill', name: 'refunds', enabled: true });
  // Said to every client, and once: the CLI's own name for it is no second row.
  expect(JSON.stringify(said.filter((one) => one.type === 'session/customizationsChanged').at(-1))).toContain('#skill=');
  await vi.waitFor(() => { expect(sdk.reloads).toBeGreaterThan(1); });
  expect(JSON.stringify(session.customizations())).not.toContain('mcp-skills:refunds');
  expect((session.customizations() as Bag[]).filter((one) => one.type === 'plugin')).toEqual([]);
  const at = join(folder() as string, 'skills', 'refunds', 'SKILL.md');
  expect(existsSync(at)).toBe(true);

  const before = sdk.reloads;
  expect(await session.setCustomizationEnabled(String(child.id), false)).toBe(true);
  expect((desk()?.children as Bag[])[0]).toMatchObject({ enabled: false });
  expect(existsSync(at)).toBe(false);
  expect(sdk.reloads).toBeGreaterThan(before);
  await session.close();
  expect(existsSync(folder() as string)).toBe(false);
});

it('lists the skill of a server that was still connecting at the handshake, with no turn asked', async () => {
  sdk.status = 'pending';
  const { session, said, desk } = await opened();
  expect((desk()?.state as Bag).kind).toBe('starting');
  expect(desk()).not.toHaveProperty('children');
  sdk.status = 'connected';
  await vi.waitFor(() => { expect(desk()?.children).toHaveLength(1); }, { timeout: 5_000 });
  expect((desk()?.state as Bag).kind).toBe('ready');
  expect(said.some((one) => one.type === 'session/mcpServerStateChanged')).toBe(true);
  await session.close();
});

it('asks no server the CLI has not connected', async () => {
  sdk.status = 'needs-auth';
  const { session, desk } = await opened();
  await new Promise((r) => { setTimeout(r, 50); });
  expect(desk()).not.toHaveProperty('children');
  await session.close();
});

it('starts a session with no server with no folder', async () => {
  const { session } = await opened({ mcpServers: {} });
  expect(sdk.options.at(-1)).not.toHaveProperty('plugins');
  await session.close();
});
