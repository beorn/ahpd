import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitWorktrees } from '../src/repo/worktrees.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { localPath, uriOf } from '../src/resources/fileuri.js';
import { gitSync } from '../../../tools/git.ts';
import type { Peer } from '../src/types/rpc.js';
import type { Worktrees } from '../src/types/worktrees.js';

/*
 * `vscode/sessionWorktreeCleanup` and `vscode/prepareSessionWorktreeCleanup`:
 * the status of an archived session's tree removal, a retry, a forced
 * removal, and the refusals VS Code's host answers.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L141-L195
 */

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A repository with one commit, two levels down so its `.worktrees` sibling is under the root. */
const repository = (): { root: string; project: string } => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-wtclean-'));
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
  return { root, project };
};

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

const serving = async (worktrees: Worktrees = gitWorktrees()) => {
  const { root, project } = repository();
  const lines: string[] = [];
  const host = createHost({
    path: root,
    agents: [echo({ path: project, pace: 0 })],
    worktrees,
    sessions: memorySessions(),
    onEvent: (line) => { lines.push(line); },
  });
  hosts.push(host);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const logged = async (text: string): Promise<void> => {
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      if (lines.some((one) => one.includes(text))) return;
      await new Promise((r) => { setTimeout(r, 25); });
    }
    throw new Error(`never logged "${text}" in:\n${lines.join('\n')}`);
  };
  /** A worktree session after one finished turn, with its tree. */
  const open = async (name: string): Promise<{ channel: string; where: string }> => {
    const channel = `ahp-session:/${name}`;
    await client.handle({
      method: 'createSession',
      params: { channel, provider: 'echo', workingDirectories: [uriOf(project)], config: { isolation: 'worktree', branch: 'main' } },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat: string } } }).snapshot.state;
    const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } }) as {
      snapshot: { state: { turns: unknown[] } };
    }).snapshot.state.turns.length);
    await client.handle({
      method: 'dispatchAction',
      params: { channel: state.defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until && await turns() === 0;) await new Promise((r) => { setTimeout(r, 10); });
    await client.handle({ method: 'unsubscribe', params: { channel: state.defaultChat } });
    const after = (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { workingDirectories: string[] } } }).snapshot.state;
    await client.handle({ method: 'unsubscribe', params: { channel } });
    return { channel, where: localPath(after.workingDirectories[0] ?? '') };
  };
  const archive = (channel: string, isArchived: boolean) => client.handle({
    method: 'dispatchAction',
    params: { channel, clientSeq: 0, action: { type: 'session/isArchivedChanged', isArchived } },
  });
  const cleanup = (params: Record<string, unknown>) => client.handle({ method: 'vscode/sessionWorktreeCleanup', params });
  return { client, logged, open, archive, cleanup, project };
};

describe('a session\'s worktree cleanup, as VS Code\'s host answers it', () => {
  it('advertises the cleanup keys when the host makes worktrees', async () => {
    const { root, project } = repository();
    const host = createHost({ path: root, agents: [echo({ path: project, pace: 0 })], worktrees: gitWorktrees() });
    hosts.push(host);
    const answer = await host.accept(peer()).handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } }) as {
      _meta?: Record<string, unknown>;
    };
    expect(answer._meta).toMatchObject({
      'vscode.worktreeCleanup': true,
      'vscode.forceWorktreeCleanup': true,
      'vscode.prepareSessionWorktreeCleanup': true,
      'vscode.managedWorktrees': true,
    });
  });

  it('answers skipped with the reason for a dirty tree it kept, and removes it on a forced retry', async () => {
    const { logged, open, archive, cleanup } = await serving();
    const one = await open('dirty');
    writeFileSync(join(one.where, 'unsaved.txt'), 'work\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has changes nobody committed`);
    expect(await cleanup({ session: one.channel })).toEqual({ state: 'skipped', message: 'it has changes nobody committed' });

    expect(await cleanup({ session: one.channel, retry: true, force: true })).toEqual({ state: 'unknown' });
    expect(existsSync(one.where)).toBe(false);
    expect(await cleanup({ session: one.channel })).toEqual({ state: 'unknown' });
  });

  it('tries a kept tree again on a retry, and answers how it went', async () => {
    const { logged, open, archive, cleanup } = await serving();
    const one = await open('retried');
    writeFileSync(join(one.where, 'unsaved.txt'), 'work\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has changes nobody committed`);
    // The work committed by hand: the retry now finds the tree clean.
    gitSync(['-C', one.where, 'add', '-A']);
    gitSync(['-C', one.where, 'commit', '-q', '-m', 'saved']);
    await cleanup({ session: one.channel, retry: true });
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
  });

  it('answers unknown for a session with no removal', async () => {
    const { open, cleanup } = await serving();
    const one = await open('plain');
    expect(await cleanup({ session: one.channel })).toEqual({ state: 'unknown' });
  });

  it('refuses force without retry, and a retry of a session that is not archived, in VS Code\'s words', async () => {
    const { open, cleanup } = await serving();
    const one = await open('live');
    await expect(cleanup({ session: one.channel, force: true })).rejects.toThrow('Forced cleanup requires an explicit retry.');
    await expect(cleanup({ session: one.channel, retry: true })).rejects.toThrow('Only archived sessions can retry worktree cleanup.');
  });

  it('refuses to prepare the cleanup of a session it does not know', async () => {
    const { client } = await serving();
    await expect(client.handle({ method: 'vscode/prepareSessionWorktreeCleanup', params: { session: 'ahp-session:/nobody' } }))
      .rejects.toThrow('Only existing sessions can prepare worktree cleanup.');
  });

  it('answers the last message when a forced removal fails', async () => {
    const refusing: Worktrees = { ...gitWorktrees(), remove: async () => { throw new Error('refused'); } };
    const { logged, open, archive, cleanup } = await serving(refusing);
    const one = await open('stuck');
    await archive(one.channel, true);
    await logged(`could not remove ${one.where}`);
    await expect(cleanup({ session: one.channel, retry: true, force: true })).rejects.toThrow('refused');
    expect(await cleanup({ session: one.channel })).toEqual({ state: 'failed', message: 'refused' });
  });
});
