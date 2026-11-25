import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitWorktrees, worktreeFor, worktreesOf } from '../src/repo/worktrees.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { uriOf } from '../src/resources/fileuri.js';
import { gitSync } from '../../../tools/git.ts';
import type { Peer } from '../src/types/rpc.js';

/*
 * `vscode/listManagedWorktrees` and `vscode/cleanupManagedWorktree`: the
 * worktrees this host made that no session records, and their removal.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L197-L270
 */

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A repository with one commit, and a worktree on an `agents/` branch where the host makes its own. */
const setup = async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-managed-')));
  made.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const run = (...args: string[]) => gitSync(['-C', project, ...args]);
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(project, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  const branch = 'agents/orphan';
  const orphan = join(worktreesOf(project), worktreeFor(branch));
  run('worktree', 'add', '-q', '-b', branch, orphan);
  // A worktree outside the host's layout, which is never listed.
  const foreign = join(root, 'elsewhere');
  run('worktree', 'add', '-q', '-b', 'agents/foreign', foreign);
  const host = createHost({ path: root, agents: [echo({ path: project, pace: 0 })], worktrees: gitWorktrees(), sessions: memorySessions() });
  hosts.push(host);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const list = () => client.handle({ method: 'vscode/listManagedWorktrees', params: { repositories: [uriOf(project)] } });
  const cleanup = (params: Record<string, unknown>) => client.handle({ method: 'vscode/cleanupManagedWorktree', params });
  return { project, branch, orphan, list, cleanup, run, client };
};

describe('managed worktrees, as VS Code\'s host lists and removes them', () => {
  it('lists an orphan this host made, and removes it, keeping its branch', async () => {
    const { project, branch, orphan, list, cleanup, run } = await setup();
    expect(await list()).toEqual([{ repository: uriOf(project), worktree: uriOf(orphan), branch, cleanupStatus: { state: 'unknown' } }]);
    await cleanup({ repository: uriOf(project), worktree: uriOf(orphan), branch, force: true });
    expect(existsSync(orphan)).toBe(false);
    expect(run('branch', '--list', branch).trim()).not.toBe('');
    expect(await list()).toEqual([]);
  });

  it('refuses a worktree it did not make', async () => {
    const { project, cleanup, run } = await setup();
    const elsewhere = join(project, '..', 'elsewhere');
    await expect(cleanup({ repository: uriOf(project), worktree: uriOf(elsewhere), branch: 'agents/foreign' })).rejects.toThrow('Not a worktree this host manages');
    expect(run('worktree', 'list').includes('elsewhere')).toBe(true);
  });

  it('refuses a worktree whose branch moved, unless forced', async () => {
    const { project, branch, orphan, cleanup } = await setup();
    gitSync(['-C', orphan, 'checkout', '-q', '-b', 'agents/moved']);
    // The worktree's name no longer matches the branch it is on, so it is no longer one this host made.
    await expect(cleanup({ repository: uriOf(project), worktree: uriOf(orphan), branch })).rejects.toThrow();
    expect(existsSync(orphan)).toBe(true);
  });

  it('answers each repository once, however it is named', async () => {
    const { project, client } = await setup();
    mkdirSync(join(project, 'sub'));
    const answer = await client.handle({ method: 'vscode/listManagedWorktrees', params: { repositories: [uriOf(project), uriOf(join(project, 'sub'))] } });
    expect(answer).toHaveLength(1);
  });

  it('says a worktree a session works in is in use, and refuses to remove it unless forced', async () => {
    const { project, branch, orphan, list, cleanup, client } = await setup();
    const channel = 'ahp-session:/inside';
    await client.handle({ method: 'createSession', params: { channel, provider: 'echo', workingDirectories: [uriOf(orphan)] } });
    // A session is listed once it has been spoken in.
    const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat: string } } }).snapshot.state;
    const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: defaultChat } }) as {
      snapshot: { state: { turns: unknown[] } };
    }).snapshot.state.turns.length);
    await client.handle({
      method: 'dispatchAction',
      params: { channel: defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until && await turns() === 0;) await new Promise((r) => { setTimeout(r, 10); });
    expect(await list()).toEqual([{ repository: uriOf(project), worktree: uriOf(orphan), branch, cleanupStatus: { state: 'inUse' } }]);
    await expect(cleanup({ repository: uriOf(project), worktree: uriOf(orphan), branch }))
      .rejects.toThrow('A session, chat, or detached worktree record is still using this worktree.');
    expect(existsSync(orphan)).toBe(true);
  });

  it('keeps a worktree in use while a chat that moved out of its session works in it', async () => {
    const { project, branch, orphan, list, client } = await setup();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
    });
    const spoken = async (channel: string, where: string): Promise<void> => {
      await client.handle({ method: 'createSession', params: { channel, provider: 'echo', workingDirectories: [uriOf(where)] } });
      const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat: string } } }).snapshot.state;
      const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: defaultChat } }) as {
        snapshot: { state: { turns: unknown[] } };
      }).snapshot.state.turns.length);
      await client.handle({
        method: 'dispatchAction',
        params: { channel: defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
      });
      for (const until = Date.now() + WAIT_MS; Date.now() < until && await turns() === 0;) await new Promise((r) => { setTimeout(r, 10); });
    };
    await spoken('ahp-session:/inside', orphan);
    await spoken('ahp-session:/home', project);
    await client.handle({ method: 'vscode/moveSession', params: { session: 'ahp-session:/inside', destination: 'ahp-session:/home', after: null } });
    // No session works in the orphan now, and the chat that moved still does.
    expect(await list()).toEqual([{ repository: uriOf(project), worktree: uriOf(orphan), branch, cleanupStatus: { state: 'inUse' } }]);
  });
});

