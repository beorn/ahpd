import { WAIT_MS } from '../../../tools/wait.ts';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { measureDiskUsage, DiskUsageCancelled } from '../src/repo/diskusage.js';
import { uriOf } from '../src/resources/fileuri.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A worktree's disk usage, as VS Code's host measures one before its window
 * offers to remove it.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/worktreeDiskUsage.ts
 */

const made: string[] = [];
const hosts: ReturnType<typeof createHost>[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const folder = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-du-')));
  made.push(dir);
  return dir;
};

/** What a file takes on disk, as the measure counts it. */
const allocated = (path: string): number => lstatSync(path).blocks * 512;

/**
 * A tree with two files, one linked twice inside it, one linked from outside,
 * and a symlink out: only the first two count, the linked one once.
 */
const tree = () => {
  const root = folder();
  const inside = join(root, 'tree');
  mkdirSync(join(inside, 'nested'), { recursive: true });
  writeFileSync(join(inside, 'a.txt'), 'a'.repeat(10_000));
  writeFileSync(join(inside, 'nested', 'b.txt'), 'b'.repeat(5_000));
  linkSync(join(inside, 'nested', 'b.txt'), join(inside, 'b-again.txt'));
  writeFileSync(join(inside, 'shared.txt'), 's'.repeat(20_000));
  linkSync(join(inside, 'shared.txt'), join(root, 'shared-outside.txt'));
  writeFileSync(join(root, 'far.txt'), 'f'.repeat(30_000));
  symlinkSync(join(root, 'far.txt'), join(inside, 'far-link'));
  const expected = allocated(join(inside, 'a.txt')) + allocated(join(inside, 'nested', 'b.txt'));
  return { inside, expected };
};

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

const joined = async () => {
  const dir = folder();
  const host = createHost({ path: dir, agents: [echo({ path: dir })] });
  hosts.push(host);
  const client = host.accept(peer());
  const answer = await client.handle({ method: 'initialize', params: { clientId: 'du', protocolVersions: ['0.9.0'] } }) as { _meta?: Record<string, unknown> };
  return { client, answer };
};

describe('a worktree\'s disk usage', () => {
  it('counts the files only the tree holds, a file linked twice inside it once, and no symlink', async () => {
    const { inside, expected } = tree();
    expect(await measureDiskUsage(inside)).toBe(expected);
  });

  it('answers nothing for a root that is not there', async () => {
    expect(await measureDiskUsage(join(folder(), 'gone'))).toBeUndefined();
  });

  it('stops at a cancel', async () => {
    const { inside } = tree();
    const stop = new AbortController();
    stop.abort();
    await expect(measureDiskUsage(inside, stop.signal)).rejects.toBeInstanceOf(DiskUsageCancelled);
  });

  it('is advertised, and answered over the method', async () => {
    const { client, answer } = await joined();
    expect(answer._meta?.['vscode.worktreeDiskUsage']).toBe(true);
    const { inside, expected } = tree();
    expect(await client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: 'one' } })).toEqual({ sizeBytes: expected });
    expect(await client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(join(inside, 'gone')), requestId: 'two' } })).toEqual({});
  });

  it('refuses a URI that is not an absolute file URI, in VS Code\'s words', async () => {
    const { client } = await joined();
    await expect(client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: 'ahp-session:/x', requestId: 'r' } }))
      .rejects.toThrow('uri must be an absolute file URI');
    await expect(client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: `${uriOf(folder())}?q=1`, requestId: 'r' } }))
      .rejects.toThrow('uri must be an absolute file URI');
  });

  it('refuses a request id in use, and stops a scan at its cancel', async () => {
    const { client } = await joined();
    const { inside } = tree();
    // Asked together: the second ask and the cancel are read before the first
    // scan's first read of the disk answers.
    const first = client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: 'same' } });
    const again = client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: 'same' } });
    const cancel = client.handle({ method: 'vscode/cancelWorktreeDiskUsage', params: { requestId: 'same' } });
    await expect(again).rejects.toThrow('requestId is already in use');
    await expect(cancel).resolves.toEqual({});
    await expect(first).rejects.toThrow('Canceled');
    // The id is free once its scan ended.
    expect(await client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: 'same' } })).toHaveProperty('sizeBytes');
  });

  it('keeps a session\'s measure until the session moves', async () => {
    const { client } = await joined();
    const { inside, expected } = tree();
    const session = 'ahp-session:/du';
    await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo' } });
    const ask = (id: string) => client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: id, session } });
    expect(await ask('a')).toEqual({ sizeBytes: expected });
    // A file the session did not write: the kept measure stands.
    writeFileSync(join(inside, 'late.txt'), 'l'.repeat(40_000));
    expect(await ask('b')).toEqual({ sizeBytes: expected });
    // Without the session the folder is measured again.
    expect(await client.handle({ method: 'vscode/measureWorktreeDiskUsage', params: { uri: uriOf(inside), requestId: 'c' } }))
      .toEqual({ sizeBytes: expected + allocated(join(inside, 'late.txt')) });
    // The session moves, and its measure is taken again.
    const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel: session } }) as { snapshot: { state: { defaultChat: string } } }).snapshot.state;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: defaultChat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    const limit = Date.now() + WAIT_MS;
    let answer: unknown;
    for (let i = 0; Date.now() < limit; i++) {
      answer = await ask(`d${String(i)}`);
      if ((answer as { sizeBytes?: number }).sizeBytes !== expected) break;
      await new Promise((r) => { setTimeout(r, 25); });
    }
    expect(answer).toEqual({ sizeBytes: expected + allocated(join(inside, 'late.txt')) });
  });
});

