import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitChanges } from '../src/sessions/changes.js';
import { idOf } from '../src/sessions/catalog.js';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitSync } from '../../../tools/git.ts';

/*
 * A chat's own changesets, as VS Code main's host names This Turn under the
 * chat: `<chatUri>/changeset/turn/<turnId>`. The session's list stays as it is.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/changesetUri.ts#L442-L540
 */

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const settle = () => new Promise((r) => { setTimeout(r, 50); });

/** A host on a repository with a dirty file, a session in it, and its default chat. */
const serving = async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-chatcs-')));
  made.push(dir);
  gitSync(['init', '-q', '-b', 'main', dir]);
  gitSync(['-C', dir, 'config', 'user.email', 'test@example.com']);
  gitSync(['-C', dir, 'config', 'user.name', 'Test']);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'a.md'), 'committed\n');
  gitSync(['-C', dir, 'add', '-A']);
  gitSync(['-C', dir, 'commit', '-q', '-m', 'first']);
  writeFileSync(join(dir, 'docs', 'a.md'), 'changed\n');
  const changes = gitChanges();
  const host = createHost({ path: dir, agents: [echo({ path: dir })], changes });
  hosts.push(host);
  const actions: { channel: string; type: string; changesets?: unknown }[] = [];
  const client = host.accept({
    send: () => {},
    notify: (method, params) => {
      const p = params as { channel?: string; action?: { type?: string; changesets?: unknown } };
      if (method === 'action' && p.action?.type !== undefined) actions.push({ channel: String(p.channel), type: p.action.type, changesets: p.action.changesets });
    },
    request: async () => ({}), answered: () => {}, close: () => {},
  });
  await client.handle({ method: 'initialize', params: { clientId: 'chatcs', protocolVersions: ['0.9.0'] } });
  const session = 'ahp-session:/chatcs';
  await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo' } });
  await changes.refresh?.(dir);
  const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel: session } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state;
  /** A turn of the session that changed `docs/a.md`, as the backend's edit would be seen. */
  const turned = async (turn: string): Promise<void> => {
    const file = join(dir, 'docs', 'a.md');
    // By the session's id, as the host hands every call of the port.
    changes.observe?.(dir, idOf(session), turn, file, 'before');
    await settle();
    writeFileSync(file, `in ${turn}\n`);
    changes.observe?.(dir, idOf(session), turn, file, 'after');
    await settle();
  };
  /** A turn of the echo backend on the default chat, ended: a session's row moves at each turn. */
  const spoken = async (turnId: string): Promise<void> => {
    const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: defaultChat } }) as {
      snapshot: { state: { turns: unknown[] } };
    }).snapshot.state.turns.length);
    const before = await turns();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until && await turns() === before;) await settle();
  };
  const chatState = async () => (await client.handle({ method: 'subscribe', params: { channel: defaultChat } }) as {
    snapshot: { state: { changesets?: { uriTemplate: string; changeKind: string }[] } };
  }).snapshot.state;
  return { client, session, defaultChat, turned, spoken, chatState, actions, changes, dir };
};

describe('a chat\'s own changesets', () => {
  it('lists Branch, Uncommitted, This Turn and Compare Turns under the chat, and no Session entry', async () => {
    const { defaultChat, turned, spoken, chatState } = await serving();
    await turned('t1');
    await spoken('t2');
    const state = await chatState();
    expect(state.changesets?.map((one) => one.uriTemplate)).toEqual([
      `${defaultChat}/changeset/uncommitted`,
      `${defaultChat}/changeset/turn/{turnId}`,
      `${defaultChat}/changeset/compare/{originalTurnId}/{modifiedTurnId}`,
    ]);
  });

  it('keeps the session\'s own list as it was', async () => {
    const { client, session, turned, changes, dir } = await serving();
    await turned('t1');
    await changes.refresh?.(dir);
    const state = (await client.handle({ method: 'subscribe', params: { channel: session } }) as {
      snapshot: { state: { changesets?: { uriTemplate: string }[] } };
    }).snapshot.state;
    expect(state.changesets?.map((one) => one.uriTemplate)).toEqual([
      `${session}/changeset/uncommitted`,
      `${session}/changeset/session`,
      `${session}/changeset/turn/{turnId}`,
      `${session}/changeset/compare/{originalTurnId}/{modifiedTurnId}`,
    ]);
  });

  it('answers a turn\'s files under the chat, the same as under the session', async () => {
    const { client, session, defaultChat, turned } = await serving();
    await turned('t1');
    const read = async (channel: string) => (await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { files: { edit: { after?: { uri: string } } }[] } };
    }).snapshot.state.files;
    const underChat = await read(`${defaultChat}/changeset/turn/t1`);
    expect(underChat).toHaveLength(1);
    expect(underChat).toEqual(await read(`${session}/changeset/turn/t1`));
    expect(await read(`${defaultChat}/changeset/uncommitted`)).toHaveLength(1);
  });

  it('says a chat\'s list again when the session\'s list moves', async () => {
    const { defaultChat, turned, spoken, chatState, actions } = await serving();
    const before = await chatState();
    expect(before.changesets?.map((one) => one.changeKind)).toEqual(['uncommitted']);
    await turned('t1');
    await spoken('t2');
    for (const until = Date.now() + WAIT_MS; Date.now() < until && !actions.some((one) => one.channel === defaultChat && one.type === 'chat/changesetsChanged');) await settle();
    const said = actions.find((one) => one.channel === defaultChat && one.type === 'chat/changesetsChanged');
    expect((said?.changesets as { changeKind: string }[] | undefined)?.map((one) => one.changeKind)).toEqual(['uncommitted', 'turn', 'compare-turns']);
  });
});
