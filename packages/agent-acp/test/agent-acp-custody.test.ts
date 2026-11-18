/*
 * 34599: the host's custody record outlives its ACP child.
 *
 * hab's stop proves a hosted seat's child ended from the record the host keeps at HAB_ACP_PID_PREFIX. The old
 * `.pid`/`.stat` pair was deleted the moment its child exited, which is exactly when a stop needs it, so a stop
 * could not tell "never started" from "started and died". The record (`<prefix>.custody`) is written only by the
 * host, kept through the child's end, and every write is ordered by one per-seat lock (`<prefix>.lock`, never
 * deleted) held from admission until the child's end is recorded. Ruling: @cto 34599-retained-record-r3-go.
 */
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { Bag, Session } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { acpAgent } from '../src/index.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));
const URI = 'ahp-session:/custody';
const linux = process.platform === 'linux';
const sessions: Session[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map((session) => session.close()));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`still waiting after ${ms} ms`);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
};

type Custody = {
  v: number; bootId: string; opening: string; seq: number; state: 'spawning' | 'running' | 'ended';
  host: { pid: number; stat: string }; child: { pid: number; stat: string } | null;
};

const bootId = (): string => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const readCustody = (prefix: string): Custody => JSON.parse(readFileSync(`${prefix}.custody`, 'utf8')) as Custody;
const alive = (pid: number): boolean => existsSync(`/proc/${pid}`) && !/^\d+ \(.*\) Z /su.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
const logged = (log: string): Bag[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  .map((line) => JSON.parse(line) as Bag) : []);
const initializes = (log: string): Bag[] => logged(log).filter((line) => line.method === 'fixture/pid-at-initialize');

async function start(args: string[], extra: Record<string, unknown> = {}): Promise<{ session: Session; prefix: string; log: string; actions: Bag[] }> {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-34599-'));
  folders.push(folder);
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  const actions: Bag[] = [];
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE, '--observe-pid-custody', ...args], provider: 'custody',
    env: { ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: URI }, ...extra });
  const session = await agent.create({ uri: URI, chatUri: 'ahp-chat:/original', sessionConversation: true,
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder, trusted: () => true,
    schema: () => ({ type: 'object', properties: {} }), emit: (_channel, action) => { actions.push(action as Bag); } });
  sessions.push(session);
  return { session, prefix, log, actions };
}

it.skipIf(!linux)('names the running child before initialize and keeps the record, ended, after the child exits', async () => {
  const { session, prefix, log } = await start([]);
  const [first] = initializes(log);
  expect(first).toBeDefined();
  // The record the child sees at initialize: running, this boot, this host, this child.
  const atInit = JSON.parse(String(first?.custodyRecord)) as Custody;
  expect(atInit).toMatchObject({ v: 1, bootId: bootId(), state: 'running', host: { pid: process.pid } });
  expect(atInit.child?.pid).toBe(first?.pid);
  expect(atInit.child?.stat).toMatch(new RegExp(`^${String(first?.pid)} \\(`));
  expect(atInit.host.stat).toMatch(new RegExp(`^${String(process.pid)} \\(`));
  expect(typeof atInit.opening).toBe('string');
  expect(atInit.opening.length).toBeGreaterThan(0);
  // The old pair is no longer written: the record is the one authority.
  expect(first?.pidRecord).toBeNull();
  expect(first?.statRecord).toBeNull();
  await session.close();
  const child = atInit.child?.pid ?? 0;
  await until(() => !alive(child));
  await until(() => readCustody(prefix).state === 'ended');
  const after = readCustody(prefix);
  expect(after).toMatchObject({ v: 1, bootId: atInit.bootId, opening: atInit.opening, state: 'ended', child: atInit.child });
  expect(after.seq).toBeGreaterThan(atInit.seq);
  // The lock file stays: deleting a flock file breaks exclusion.
  expect(existsSync(`${prefix}.lock`)).toBe(true);
  expect(existsSync(`${prefix}.pid`)).toBe(false);
  expect(existsSync(`${prefix}.stat`)).toBe(false);
});

it.skipIf(!linux)('a failed turn whose child ignores TERM admits no replacement until the predecessor has ended', async () => {
  // The predecessor ignores TERM, so only the configured kill grace ends it. The next turn's opening must wait for
  // that end: two children of one seat never overlap, and the record names the predecessor until then.
  const { session, prefix, log, actions } = await start(['--ignore-term', '--fail-method=session/prompt'], { killGraceMs: 1500 });
  const first = initializes(log)[0];
  const pid1 = Number(first?.pid);
  session.sendMessage('t1', 'fail this turn');
  await until(() => actions.some((action) => action.type === 'chat/error'));
  session.sendMessage('t2', 'a new turn spawns a replacement');
  // While the predecessor lives, nothing new has spawned and the record still names it.
  const died = (async () => { await until(() => !alive(pid1)); return Date.now(); })();
  await until(() => initializes(log).length >= 2 || !alive(pid1));
  if (alive(pid1)) {
    expect(initializes(log).length).toBe(1);
    expect(readCustody(prefix).child?.pid).toBe(pid1);
  }
  const deathAt = await died;
  await until(() => initializes(log).length >= 2);
  const second = initializes(log)[1];
  expect(Number(second?.at)).toBeGreaterThanOrEqual(deathAt - 20);
  const record = JSON.parse(String(second?.custodyRecord)) as Custody;
  expect(record.state).toBe('running');
  expect(record.child?.pid).toBe(second?.pid);
  expect(record.opening).not.toBe((JSON.parse(String(first?.custodyRecord)) as Custody).opening);
});
