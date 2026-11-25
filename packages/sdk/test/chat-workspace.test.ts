/*
 * A chat created in a workspace of its own.
 *
 * `createChat` carries the workspace in `_meta['vscode.chatWorkspace']`: a
 * scratch folder this host makes, a folder the chat works in, or a new worktree
 * of a folder. The chat is started, then moved before it is said, so the first
 * message and every turn after it run in the folder the client asked for.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { localPath, uriOf } from '../src/resources/fileuri.js';
import { gitWorktrees, worktreesOf } from '../src/repo/worktrees.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitSync } from '../../../tools/git.ts';
import { WAIT_MS } from '../../../tools/wait.ts';
import { actions, defaultChatOf, hello, peer, settle } from './support/host.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';

const SESSION = 'ahp-session:/workspace';
const CHAT = 'ahp-chat:/isolated';

/** Every temporary folder a case made, and every scratch folder it left in the home directory. */
const made: string[] = [];
const scratch: string[] = [];

afterEach(() => {
  for (const one of scratch.splice(0)) rmSync(one, { recursive: true, force: true });
  for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** A folder under a fresh root, made now. */
const folderIn = (root: string, name: string): string => {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** The echo backend, keeping the folder each start was handed. */
const backend = (base: string, folderPerChat = true, fork = false): { agent: Agent; starts: string[] } => {
  const plain = echo({ path: base, pace: 0 });
  const starts: string[] = [];
  const agent: Agent = {
    ...plain,
    ...(folderPerChat ? { multipleDirectories: true } : {}),
    ...(fork ? { chats: { fork: true } } : {}),
    create: (start: Start): Session => {
      starts.push(start.workingDirectory ?? '');
      return plain.create(start);
    },
  };
  return { agent, starts };
};

/** A client on one session working in `base`, with the host behind it. */
async function opened({
  root, base, folderPerChat = true, worktrees = false, fork = false,
}: {
  root: string;
  base: string;
  folderPerChat?: boolean;
  worktrees?: boolean;
  fork?: boolean;
}): Promise<{
  client: ReturnType<ReturnType<typeof createHost>['accept']>;
  peer: ReturnType<typeof peer>;
  asked: string[];
  starts: string[];
  defaultChat: string;
}> {
  const { agent, starts } = backend(base, folderPerChat, fork);
  const host = createHost({
    path: root,
    agents: [agent],
    ...(worktrees ? { worktrees: gitWorktrees() } : {}),
  });
  const p = peer();
  // What the host put to the calling window, and the answer a window that
  // trusts the folder gives.
  const asked: string[] = [];
  p.request = async (method) => {
    asked.push(method);
    return method === 'vscode/requestWorkspaceTrust' ? { trusted: true } : {};
  };
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo', workingDirectories: [uriOf(base)] } });
  const defaultChat = await defaultChatOf(client, SESSION);
  return { client, peer: p, asked, starts, defaultChat };
}

/** The folders a session's workspace was told to join. */
const joined = (p: ReturnType<typeof peer>): string[] => actions(p, SESSION)
  .filter((one) => one.action.type === 'session/workingDirectorySet')
  .map((one) => localPath(String(one.action.directory)));

/** The text of every turn a chat holds, the running one included. */
const said = async (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  chat: string,
): Promise<string[]> => {
  const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns?: { message?: { text?: string } }[]; activeTurn?: { message?: { text?: string } } } };
  }).snapshot.state;
  return [state.activeTurn, ...(state.turns ?? [])]
    .filter((one): one is { message?: { text?: string } } => one !== undefined)
    .map((one) => one.message?.text ?? '');
};

/** Waits for a chat to say `text`, or fails saying it never did. */
const untilSaid = async (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  chat: string,
  text: string,
): Promise<void> => {
  for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
    if ((await said(client, chat)).includes(text)) return;
    await settle(2);
  }
  throw new Error(`${chat} never said ${JSON.stringify(text)}`);
};

/** Waits for a chat to hold a finished turn, or fails saying it never did. */
const untilTurned = async (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  chat: string,
): Promise<void> => {
  for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { turns?: unknown[] } };
    }).snapshot.state;
    if ((state.turns ?? []).length > 0) return;
    await settle(2);
  }
  throw new Error(`${chat} never finished a turn`);
};

it('starts a chat in the folder it was given', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const folder = folderIn(root, 'folder');
  const { client, peer: p, asked, starts } = await opened({ root, base });

  // Past the start the session itself made, so the two here are the chat's.
  const before = starts.length;
  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'folder', folder: uriOf(folder), isolation: 'folder' } } },
  });
  await settle();

  // The chat was started in its session's folder and started again in the one it was given.
  expect(starts.slice(before)).toEqual([base, folder]);
  expect(joined(p)).toEqual([folder]);
  // The calling window vouched for the folder and the host did not start one.
  expect(asked).toContain('vscode/requestWorkspaceTrust');
  const added = actions(p, SESSION).find((one) => one.action.type === 'session/chatAdded');
  expect((added?.action as { summary?: { resource?: string } }).summary?.resource).toBe(CHAT);
});

it('makes a scratch folder of the chat\'s own', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-scratch-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, asked, starts } = await opened({ root, base });

  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'scratch' } } },
  });
  await settle();

  const where = starts.at(-1) ?? '';
  expect(where.startsWith(join(homedir(), '.copilot', 'chats'))).toBe(true);
  // The host's own folder, so the window is asked nothing about it.
  expect(asked).not.toContain('vscode/requestWorkspaceTrust');
  if (where !== '') scratch.push(where);
});

it('cuts a worktree from the branch it was named, and runs the prompt as the chat\'s first turn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-worktree-'));
  made.push(root);
  const base = folderIn(root, 'project');
  // A branch that is not the checked-out one, with a file only it has, so the
  // tree says which branch it was cut from.
  const run = (...args: string[]): string => gitSync(['-C', base, ...args]);
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(base, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  run('checkout', '-q', '-b', 'release');
  writeFileSync(join(base, 'release.txt'), 'release\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'release');
  run('checkout', '-q', 'main');

  const { client, peer: p, starts } = await opened({ root, base, worktrees: true });
  await client.handle({
    method: 'createChat',
    params: {
      channel: SESSION,
      chat: CHAT,
      _meta: {
        'vscode.chatWorkspace': {
          kind: 'folder', folder: uriOf(base), isolation: 'worktree', baseBranch: 'release', prompt: 'begin here',
        },
      },
    },
  });

  const where = starts.at(-1) ?? '';
  expect(where.startsWith(worktreesOf(base))).toBe(true);
  expect(existsSync(join(where, 'release.txt'))).toBe(true);
  expect(readFileSync(join(where, 'release.txt'), 'utf8')).toBe('release\n');
  // The branch `cutTree` names for a chat, cut from the one the client named.
  expect(gitSync(['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(`agents/${'isolated'}`);
  expect(joined(p)).toEqual([where]);
  await untilSaid(client, CHAT, 'begin here');
});

it('refuses each malformed value before a chat exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-invalid-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, peer: p, starts } = await opened({ root, base });

  const invalid: unknown[] = [
    { kind: 'elsewhere' },
    { kind: 'folder', folder: 'relative/folder', isolation: 'folder' },
    { kind: 'folder', folder: 'file:relative', isolation: 'folder' },
    { kind: 'folder', folder: 'https://example.com/folder', isolation: 'folder' },
    { kind: 'folder', folder: uriOf(base), isolation: 'worktree' },
    { kind: 'folder', folder: uriOf(base), isolation: 'worktree', prompt: 'go', baseBranch: '   ' },
    { kind: 'folder', folder: uriOf(base), isolation: 'worktree', prompt: 'go', baseBranch: '-x' },
  ];
  for (const value of invalid) {
    await expect(client.handle({
      method: 'createChat',
      params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': value } },
    })).rejects.toThrow('Invalid chat workspace');
  }
  expect(starts).toEqual([base]);
  expect(actions(p, SESSION).some((one) => one.action.type === 'session/chatAdded')).toBe(false);
});

it('refuses a workspace beside working directories, a fork or a side chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-combined-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client } = await opened({ root, base });
  const workspace = { kind: 'folder', folder: uriOf(base), isolation: 'folder' };

  await expect(client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, workingDirectories: [uriOf(base)], _meta: { 'vscode.chatWorkspace': workspace } },
  })).rejects.toThrow('A chat workspace cannot be combined with working directories, a fork or a side chat.');
  await expect(client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, source: { kind: 'sideChat', chat: CHAT, turnId: 't1' }, _meta: { 'vscode.chatWorkspace': workspace } },
  })).rejects.toThrow('A chat workspace cannot be combined with working directories, a fork or a side chat.');
  await expect(client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, source: { kind: 'fork', chat: CHAT, turnId: 't1' }, _meta: { 'vscode.chatWorkspace': workspace } },
  })).rejects.toThrow('A chat workspace cannot be combined with working directories, a fork or a side chat.');
});

it('refuses the default chat a workspace of its own', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-default-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, defaultChat } = await opened({ root, base });

  await expect(client.handle({
    method: 'createChat',
    params: {
      channel: SESSION,
      chat: defaultChat,
      initialMessage: { text: 'hello', origin: { kind: 'user' } },
      _meta: { 'vscode.chatWorkspace': { kind: 'folder', folder: uriOf(base), isolation: 'folder' } },
    },
  })).rejects.toThrow('The default chat cannot get a workspace of its own.');
});

it('refuses an agent without a folder per chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-single-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client } = await opened({ root, base, folderPerChat: false });

  await expect(client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'folder', folder: uriOf(base), isolation: 'folder' } } },
  })).rejects.toThrow('The agent echo does not support a workspace per chat.');
});

it('refuses a folder inside a chat\'s scratch folder, in VS Code\'s words', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-scratch-folder-'));
  made.push(root);
  const chats = join(homedir(), '.copilot', 'chats');
  const own = join(chats, `ahpd-workspace-${process.pid}`);
  const inside = join(own, 'project');
  scratch.push(own);
  const base = folderIn(root, 'base');
  const { client, peer: p, asked, starts } = await opened({ root, base });

  const ask = (folder: string) => client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'folder', folder: uriOf(folder), isolation: 'folder' } } },
  });

  await expect(ask(own))
    .rejects.toThrow(`'${own}' is a chat's own scratch folder; pick No Workspace for a scratch folder of its own.`);
  await expect(ask(inside))
    .rejects.toThrow(`'${inside}' is inside '${own}', a chat's own scratch folder; pick No Workspace for a scratch folder of its own.`);
  // Neither refusal started anything or asked a window about a folder.
  expect(starts).toEqual([base]);
  expect(asked).not.toContain('vscode/requestWorkspaceTrust');
  expect(actions(p, SESSION).some((one) => one.action.type === 'session/chatAdded')).toBe(false);
});

/*
 * `vscode/setChatWorkspace`: a chat that has not started is moved to the
 * folder, worktree or scratch folder the client asks for, with the window
 * asked about the folder and no turn behind the move.
 */

/** The workspace value a client sends to the method. */
const folderWorkspace = (folder: string) => ({ kind: 'folder', folder: uriOf(folder), isolation: 'folder' });

it('moves a chat that has not started, with no turn behind it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-move-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const folder = folderIn(root, 'folder');
  const { client, peer: p, asked, starts } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();

  const before = starts.length;
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: folderWorkspace(folder) } });
  await settle();

  // The chat was started again in the folder it asked for, and no turn follows.
  expect(starts.slice(before)).toEqual([folder]);
  expect(joined(p)).toEqual([folder]);
  expect(await said(client, CHAT)).toEqual([]);
  // The calling window vouched for the folder.
  expect(asked).toContain('vscode/requestWorkspaceTrust');
});

it('gives a chat a scratch folder of its own', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-scratch-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, asked, starts } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();

  const before = starts.length;
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: { kind: 'scratch' } } });
  await settle();

  const where = starts.at(-1) ?? '';
  expect(starts.slice(before)).toEqual([where]);
  expect(where.startsWith(join(homedir(), '.copilot', 'chats'))).toBe(true);
  // The host's own folder, so the window is asked nothing about it.
  expect(asked).not.toContain('vscode/requestWorkspaceTrust');
  if (where !== '') scratch.push(where);
});

it('cuts a worktree for a chat from the branch it was named', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-worktree-'));
  made.push(root);
  const base = folderIn(root, 'project');
  const run = (...args: string[]): string => gitSync(['-C', base, ...args]);
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(base, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  run('checkout', '-q', '-b', 'release');
  writeFileSync(join(base, 'release.txt'), 'release\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'release');
  run('checkout', '-q', 'main');
  const { client, peer: p, starts } = await opened({ root, base, worktrees: true });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();

  await client.handle({
    method: 'vscode/setChatWorkspace',
    params: {
      chat: CHAT,
      workspace: { kind: 'folder', folder: uriOf(base), isolation: 'worktree', baseBranch: 'release', prompt: 'begin here' },
    },
  });

  const where = starts.at(-1) ?? '';
  expect(where.startsWith(worktreesOf(base))).toBe(true);
  expect(readFileSync(join(where, 'release.txt'), 'utf8')).toBe('release\n');
  expect(gitSync(['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('agents/isolated');
  expect(joined(p)).toEqual([where]);
});

it('leaves a chat already in the folder it asks for', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-same-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, starts } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();

  const before = starts.length;
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: folderWorkspace(base) } });
  await settle();

  expect(starts.length).toBe(before);
});

it('leaves a chat already in a scratch folder of its own', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-own-scratch-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, starts } = await opened({ root, base });
  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'scratch' } } },
  });
  await settle();
  const own = starts.at(-1) ?? '';
  if (own !== '') scratch.push(own);

  const before = starts.length;
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: { kind: 'scratch' } } });
  await settle();

  expect(starts.length).toBe(before);
  expect(existsSync(own)).toBe(true);
});

it('refuses the default chat and a chat this host does not run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-refused-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, defaultChat } = await opened({ root, base });

  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: defaultChat, workspace: { kind: 'scratch' } },
  })).rejects.toThrow('The default chat cannot get a workspace of its own.');

  const stranger = 'ahp-chat:/somewhere-else';
  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: stranger, workspace: { kind: 'scratch' } },
  })).rejects.toThrow(`${stranger} is not a chat of a session this host is running.`);
});

it('refuses a chat a person did not make', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-fork-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client, defaultChat } = await opened({ root, base, fork: true });
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: defaultChat,
      clientSeq: 1,
      action: {
        type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(),
        message: { text: 'hello', origin: { kind: 'user' } },
      },
    },
  });
  await untilTurned(client, defaultChat);
  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, source: { kind: 'fork', chat: defaultChat, turnId: 't1' } },
  });
  await settle();

  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: CHAT, workspace: { kind: 'scratch' } },
  })).rejects.toThrow('Only a chat a person made can be given a workspace.');
});

it('refuses an agent without a folder per chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-single-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const { client } = await opened({ root, base, folderPerChat: false });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();

  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: CHAT, workspace: { kind: 'scratch' } },
  })).rejects.toThrow('The agent echo does not support a workspace per chat.');
});

it('refuses a chat that has started', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-started-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const folder = folderIn(root, 'folder');
  const { client, starts } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: CHAT,
      clientSeq: 2,
      action: {
        type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(),
        message: { text: 'hello', origin: { kind: 'user' } },
      },
    },
  });
  await settle();
  const before = starts.length;

  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: CHAT, workspace: folderWorkspace(folder) },
  })).rejects.toThrow('A chat that has started cannot be given a workspace.');
  expect(starts.length).toBe(before);
});

it('refuses a folder inside a chat\'s scratch folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-scratch-folder-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const own = join(homedir(), '.copilot', 'chats', `ahpd-set-${process.pid}`);
  const { client, starts } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();
  const before = starts.length;

  await expect(client.handle({
    method: 'vscode/setChatWorkspace',
    params: { chat: CHAT, workspace: folderWorkspace(own) },
  })).rejects.toThrow(`'${own}' is a chat's own scratch folder; pick No Workspace for a scratch folder of its own.`);
  expect(starts.length).toBe(before);
});

it('refuses a second request and a first message while the first move runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-running-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const folder = folderIn(root, 'folder');
  const { client, peer: p } = await opened({ root, base });
  await client.handle({ method: 'createChat', params: { channel: SESSION, chat: CHAT } });
  await settle();
  const workspace = folderWorkspace(folder);
  let second: Promise<unknown> | undefined;
  let firstMessage: Promise<unknown> | undefined;
  let askedDuring = false;
  // The window is asked about the folder while the move waits, which is where
  // the second request and the first message arrive.
  p.request = async (method) => {
    if (method === 'vscode/requestWorkspaceTrust' && !askedDuring) {
      askedDuring = true;
      second = client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace } });
      firstMessage = client.handle({
        method: 'dispatchAction',
        params: {
          channel: CHAT,
          clientSeq: 7,
          action: {
            type: 'chat/turnStarted', turnId: 'too-early', startedAt: new Date().toISOString(),
            message: { text: 'early', origin: { kind: 'user' } },
          },
        },
      });
    }
    return method === 'vscode/requestWorkspaceTrust' ? { trusted: true } : {};
  };

  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace } });
  await firstMessage;
  await expect(second).rejects.toThrow('The chat is already being given a workspace.');
  await settle();
  const refused = p.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as { channel?: string; origin?: { clientSeq?: number }; rejectionReason?: string })
    .filter((one) => one.channel === CHAT && one.origin?.clientSeq === 7);
  expect(refused.map((one) => one.rejectionReason)).toEqual(['The chat is being given a workspace.']);
});

it('releases the folder a chat leaves once it works in the new one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-release-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const own = folderIn(root, 'own');
  const next = folderIn(root, 'next');
  const { client, peer: p } = await opened({ root, base });
  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': folderWorkspace(own) } },
  });
  await settle();
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: folderWorkspace(next) } });
  await settle();

  const removed = actions(p, SESSION)
    .filter((one) => one.action.type === 'session/workingDirectoryRemoved')
    .map((one) => localPath(String(one.action.directory)));
  expect(removed).toEqual([own]);
  expect(joined(p)).toEqual([own, next]);
});

it('removes the scratch folder a chat leaves once it works in the new one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-chat-workspace-scratch-release-'));
  made.push(root);
  const base = folderIn(root, 'base');
  const next = folderIn(root, 'next');
  const { client, starts } = await opened({ root, base });
  await client.handle({
    method: 'createChat',
    params: { channel: SESSION, chat: CHAT, _meta: { 'vscode.chatWorkspace': { kind: 'scratch' } } },
  });
  await settle();
  const own = starts.at(-1) ?? '';
  expect(own).not.toBe('');
  await client.handle({ method: 'vscode/setChatWorkspace', params: { chat: CHAT, workspace: folderWorkspace(next) } });
  await settle();

  expect(existsSync(own)).toBe(false);
});
