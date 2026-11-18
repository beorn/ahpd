/*
 * 34599: a failed stamp never manufactures `ended`.
 *
 * When the `running` write fails after the child spawned, the record stays `spawning` and the lock stays held until
 * the child's end is recorded: a stop or a successor then waits for that end instead of reading "no child".
 */
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Session } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { acpAgent } from '../src/index.js';

const writes: { state: string; landed: boolean }[] = [];
vi.mock('@bearly/durable-file', async (original) => {
  const real = await original<typeof import('@bearly/durable-file')>();
  return {
    ...real,
    atomicWriteFileSync: (path: string, data: string) => {
      const state = path.endsWith('.custody') ? String((JSON.parse(data) as { state?: string }).state) : '';
      if (state === 'running') {
        writes.push({ state, landed: false });
        throw new Error('fixture refused the running write');
      }
      real.atomicWriteFileSync(path, data);
      if (state !== '') writes.push({ state, landed: true });
    },
  };
});

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

it.skipIf(process.platform !== 'linux')('a failed running stamp keeps spawning and the lock until the child has ended', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-stamp-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  let session: Session | undefined;
  const errors: unknown[] = [];
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'custody-stamp', env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: 'ahp-session:/custody',
    } });
    try {
      session = await agent.create({ uri: 'ahp-session:/custody', chatUri: 'ahp-chat:/original', sessionConversation: true,
        clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
        trusted: () => true, schema: () => ({ type: 'object', properties: {} }),
        emit: (_channel, action) => { if ((action as { type?: string }).type === 'chat/error') errors.push(action); },
      });
    }
    catch (error) { errors.push(error); }
    const end = Date.now() + 10_000;
    while (!writes.some((write) => write.state === 'ended')) {
      if (Date.now() > end) throw new Error(`no ended write: ${JSON.stringify(writes)}`);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
    // spawning landed, running was refused, and only the child's end was recorded after it.
    expect(writes).toEqual([{ state: 'spawning', landed: true }, { state: 'running', landed: false }, { state: 'ended', landed: true }]);
    const record = JSON.parse(readFileSync(`${prefix}.custody`, 'utf8')) as { state: string; child: { pid: number } | null };
    expect(record.state).toBe('ended');
    expect(record.child?.pid).toBeGreaterThan(1);
    expect(existsSync(`/proc/${String(record.child?.pid)}/status`) && !readFileSync(`/proc/${String(record.child?.pid)}/stat`, 'utf8').includes(') Z ')).toBe(false);
  }
  finally { await session?.close(); rmSync(folder, { recursive: true, force: true }); }
});
