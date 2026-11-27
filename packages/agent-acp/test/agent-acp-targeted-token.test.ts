import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * A client answering one MCP server's sign-in names it by the session and the
 * customization id the host published (AHP authentication.md, "target"). An
 * ACP session is handed its servers as `Start.mcpServers` and, until it
 * published them, held none a target could name, so the host refused every
 * targeted token for it with -32602. The fixture is the real ACP server.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
}

const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/** A signed-in client with one ACP session, opened with two configured servers. */
async function talking(turn = true) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-target-'));
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'acp' })],
    users: anyone(),
    mcpServers: {
      desk: { type: 'http', url: 'https://desk.example/mcp' },
      files: { type: 'stdio', command: 'mcp-files' },
    },
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/one';
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } },
    },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'acp', workingDirectories: [uriOf(path)] } });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  if (!turn) return { client, p, uri };
  // The server is opened for the first turn, which is where it is handed its servers.
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } } },
  });
  // Settled once the turn is: the server has been opened and told its servers by then.
  await until(() => p.notes.some((n) => n.method === 'action'
    && (n.params as { channel: string; action: Bag }).channel === chatUri
    && (n.params as { channel: string; action: Bag }).action.type === 'chat/turnComplete'));
  return { client, p, uri };
}

/** The MCP servers the session last said it holds, by name. */
const serversSaid = (p: ReturnType<typeof peer>, uri: string): Record<string, Bag> => {
  const said = p.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { channel: string; action: Bag })
    .filter((one) => one.channel === uri && one.action.type === 'session/customizationsChanged')
    .at(-1)?.action.customizations as Bag[] | undefined;
  return Object.fromEntries((said ?? []).filter((one) => one.type === 'mcpServer').map((one) => [String(one.name), one]));
};

it('takes a token aimed at a configured server of an ACP session, by the id the session published', async () => {
  const { client, p, uri } = await talking();
  const id = 'acp-internal:/mcp/desk#mcp=desk';

  // Asked first, so the refusal this replaces is what an old host answers here.
  await expect(client.handle({
    method: 'authenticate',
    params: { resource: 'https://desk.example/', token: 'desk-token', target: { kind: 'mcpServer', session: uri, customizationId: id } },
  })).resolves.toEqual({});
  expect(serversSaid(p, uri)['desk']).toMatchObject({ id, state: { kind: 'ready' } });
});

it('still refuses a target that names no server of the session', async () => {
  const { client, uri } = await talking();

  await expect(client.handle({
    method: 'authenticate',
    params: { resource: 'https://desk.example/', token: 'x', target: { kind: 'mcpServer', session: uri, customizationId: 'acp-internal:/mcp/nope#mcp=nope' } },
  })).rejects.toMatchObject({ message: 'Authentication target must identify an MCP server in an existing session' });
});

it('takes a token aimed at a configured server before the first turn, by the id the session published', async () => {
  // The session has run no turn, so nothing is opened yet. The servers it was
  // configured with are its customizations from creation, so the target
  // resolves and the token is held for the open rather than refused with
  // -32602 for a session that published nothing.
  const { client, uri } = await talking(false);

  await expect(client.handle({
    method: 'authenticate',
    params: { resource: 'https://desk.example/', token: 'early', target: { kind: 'mcpServer', session: uri, customizationId: 'acp-internal:/mcp/desk#mcp=desk' } },
  })).resolves.toEqual({});
});
