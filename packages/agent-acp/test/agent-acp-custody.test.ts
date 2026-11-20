/*
 * 34599: the host's custody record outlives its ACP child.
 *
 * hab's stop proves a hosted seat's child ended from the record the host keeps at HAB_ACP_PID_PREFIX. The old
 * `.pid`/`.stat` pair was deleted the moment its child exited, which is exactly when a stop needs it, so a stop
 * could not tell "never started" from "started and died". The record (`<prefix>.custody`) is written only by the
 * host, kept through the child's end, and every write is ordered by one per-seat lock (`<prefix>.lock`, never
 * deleted) held from admission until the child's end is recorded. Ruling: @cto 34599-retained-record-r3-go.
 */
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import type { AcpOptions } from '../src/types.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { acpAgent } from '../src/index.js';
import { admitCustody } from '../src/session/custody.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));
const PROBE = fileURLToPath(new URL('./fixtures/flock-probe.mjs', import.meta.url));
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
  serviceSession?: { sessionId: string; generation: number };
};

const bootId = (): string => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const readCustody = (prefix: string): Custody => JSON.parse(readFileSync(`${prefix}.custody`, 'utf8')) as Custody;
const alive = (pid: number): boolean => existsSync(`/proc/${pid}`) && !/^\d+ \(.*\) Z /su.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
const logged = (log: string): Bag[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  .map((line) => JSON.parse(line) as Bag) : []);
const initializes = (log: string): Bag[] => logged(log).filter((line) => line.method === 'fixture/pid-at-initialize');

async function start(args: string[], extra: Record<string, unknown> = {}, overrides: Partial<Start> = {}): Promise<{ session: Session; prefix: string; log: string; actions: Bag[]; agent: ReturnType<typeof acpAgent>; request: Start; options: AcpOptions }> {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-34599-'));
  folders.push(folder);
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  const actions: Bag[] = [];
  const options: AcpOptions = { command: process.execPath, args: [FIXTURE, '--observe-pid-custody', ...args], provider: 'custody',
    env: extra.sessionIdEnv === undefined ? { ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: URI } : { ACP_LOG: log },
    ...(extra.sessionIdEnv === undefined ? {} : { hostScope: { configDir: folder, hostId: 'fixture-host' } }),
    presetOf: () => options, ...extra };
  const agent = acpAgent(options);
  const request: Start = { uri: URI, chatUri: 'ahp-chat:/original', sessionConversation: true,
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder, trusted: () => true,
    schema: () => ({ type: 'object', properties: {} }), emit: (_channel, action) => { actions.push(action as Bag); }, ...overrides };
  const session = await agent.create(request);
  sessions.push(session);
  const observed = initializes(log)[0]?.custodyPrefix;
  if (typeof observed !== 'string') throw new Error('Fixture did not observe the required custody prefix');
  return { session, prefix: observed, log, actions, agent, request, options };
}

it.skipIf(!linux)('projects original and peer identities per Start and reapplies them after a preset refresh', async () => {
  const original = '8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246';
  const peer = '6c67bcf2-edcf-4765-a460-229a3da9752c';
  const first = await start([], { sessionIdEnv: 'HAB_ACP_SESSION_ID' }, { uri: `ahp-session:/${original}` });
  const second = await first.agent.create({ ...first.request, chatUri: 'ahp-chat:/peer', chatId: peer, sessionConversation: false });
  sessions.push(second);
  const [one, two] = initializes(first.log);
  expect(one).toMatchObject({ forcedSessionId: original, hostSessionUri: `ahp-session:/${original}`, hostChatUri: 'ahp-chat:/original' });
  expect(two).toMatchObject({ forcedSessionId: peer, hostChatUri: 'ahp-chat:/peer' });
  expect(two?.custodyPrefix).not.toBe(one?.custodyPrefix);
  expect(String(one?.custodyPrefix)).toContain('/acp-custody/');
  expect(first.options.env).toEqual({ ACP_LOG: first.log });
  first.options.env = { ACP_LOG: first.log, REFRESHED: 'yes' };
  first.session.sendMessage('refresh', 'continue the original');
  await until(() => initializes(first.log).length === 3);
  expect(initializes(first.log)[2]).toMatchObject({ forcedSessionId: original, hostChatUri: 'ahp-chat:/original' });
  expect(first.options.env).toEqual({ ACP_LOG: first.log, REFRESHED: 'yes' });
});

// Identity refusal must precede any usable provider session; the successful
// original/peer journey cannot witness a reserved-variable or malformed-ID admission.
it.skipIf(!linux).each([
  ['HAB_ACP_PID_PREFIX', 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246', /reserved/],
  ['HAB_ACP_SESSION_URI', 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246', /reserved/],
  ['HAB_ACP_CHAT_URI', 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246', /reserved/],
  ['HAB_ACP_SPAWN_GUARD', 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246', /reserved/],
  ['HAB_ACP_SESSION_ID', 'ahp-session:/nested/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246', /original UUID/],
] as const)('refuses identity variable %s and URI %s before returning a session', async (sessionIdEnv, uri, error) => {
  await expect(start([], { sessionIdEnv }, { uri })).rejects.toThrow(error);
});

it.skipIf(!linux)('refuses a changed guard capability on refresh before admitting another turn', async () => {
  const first = await start([], { sessionIdEnv: 'HAB_ACP_SESSION_ID' }, { uri: 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246' });
  first.options.spawnGuard = 'inherited-fd-v1';
  first.session.sendMessage('changed-capability', 'must not be sent');
  await until(() => first.actions.some((action) => action.type === 'chat/error') || logged(first.log).some((line) => line.method === 'session/prompt'));
  expect(first.actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'chat/error', part: expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('capabilities changed') }) }) })]));
  expect(logged(first.log).filter((line) => line.method === 'session/prompt')).toHaveLength(0);
});

// The existing host-only custody lock test cannot witness ownership inherited
// at OS spawn; this real child must keep its distinct occurrence lock alone.
it.skipIf(!linux)('inherits the qualified guard at process birth and keeps it until actual child exit', async () => {
  const { session, prefix, log } = await start(['--adopt-spawn-guard'], {
    sessionIdEnv: 'HAB_ACP_SESSION_ID', spawnGuard: 'inherited-fd-v1',
  }, { uri: 'ahp-session:/8c0a8ce8-ad4f-46d5-9f52-1c6e0e4b7246' });
  const atInit = initializes(log)[0];
  const guard = atInit?.inheritedGuard as { fd: number; path: string; device: string; inode: string; opening: string };
  expect(guard.fd).toBe(3);
  const record = JSON.parse(String(atInit?.custodyRecord)) as Custody & { spawnGuard: { kind: string; path: string; device: string; inode: string } };
  expect(record.opening).toBe(guard.opening);
  expect(record.spawnGuard).toEqual({ kind: 'inherited-fd-v1', path: guard.path, device: guard.device, inode: guard.inode });
  expect(execFileSync(process.execPath, [PROBE, guard.path], { encoding: 'utf8' })).toBe('held');
  // The parent relinquished its duplicate; only the child keeps this path.
  const { readdirSync, readlinkSync } = await import('node:fs');
  const parentFds = readdirSync('/proc/self/fd').map((fd) => { try { return readlinkSync(`/proc/self/fd/${fd}`); } catch { return ''; } });
  expect(parentFds).not.toContain(guard.path);
  await session.close();
  await until(() => readCustody(prefix).state === 'ended');
  expect(execFileSync(process.execPath, [PROBE, guard.path], { encoding: 'utf8' })).toBe('free');
  expect(existsSync(guard.path)).toBe(true);
});

// A real killed writer and real transport child distinguish an empty stamp
// from an ended occurrence; a replaced pathname must never count as its lock.
it.skipIf(!linux).each(['before-spawn', 'after-spawn', 'replaced-inode'] as const)('reconciles only an ended original guard after host death (%s)', async (mode) => {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-guard-crash-'));
  folders.push(folder);
  const prefix = join(folder, 'child');
  const log = join(folder, 'child.jsonl');
  const host = spawn('bun', [fileURLToPath(new URL('./fixtures/custody-host.ts', import.meta.url)), prefix, log, mode, process.execPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let diagnostic = '';
  let failure: Error | undefined;
  host.stdout.on('data', (chunk) => { output += String(chunk); });
  host.stderr.on('data', (chunk) => { diagnostic += String(chunk); });
  host.on('error', (error) => { failure = error; });
  let child: number | undefined;
  try {
    await until(() => { if (failure !== undefined) throw failure; if (host.exitCode !== null) throw new Error(`Fixture host ended: ${diagnostic}`); return output.includes('\n'); });
    const retained = JSON.parse(output.trim()) as { record: Custody & { spawnGuard: { path: string } }; childPid?: number };
    child = retained.childPid;
    const old = retained.record;
    expect(old).toMatchObject({ state: 'spawning', host: { pid: host.pid }, child: null });
    host.kill('SIGKILL');
    await until(() => host.signalCode !== null || host.exitCode !== null);
    if (child !== undefined) {
      await expect(admitCustody(prefix, 100, 'successor', true)).rejects.toThrow('no new ACP child');
      expect(readCustody(prefix)).toEqual(old);
      process.kill(-child, 'SIGKILL');
      await until(() => !alive(child!));
    }
    if (mode === 'replaced-inode') {
      writeFileSync(`${old.spawnGuard.path}.replacement`, 'different inode');
      renameSync(`${old.spawnGuard.path}.replacement`, old.spawnGuard.path);
      await expect(admitCustody(prefix, 100, 'successor', true)).rejects.toThrow('guard');
      expect(readCustody(prefix)).toEqual(old);
      return;
    }
    const successor = await admitCustody(prefix, 100, 'successor', true);
    try {
      expect(readCustody(prefix)).toMatchObject({ opening: old.opening, seq: old.seq + 1, state: 'ended', child: null });
      expect(successor.opening).not.toBe(old.opening);
    } finally { successor.release(); }
    expect(logged(log).some((line) => line.method === 'initialize')).toBe(false);
  } finally {
    host.kill('SIGKILL');
    if (child !== undefined && alive(child)) {
      process.kill(-child, 'SIGKILL');
      await until(() => !alive(child!));
    }
    if (host.pid !== undefined) await until(() => host.signalCode !== null || host.exitCode !== null);
  }
});

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

it.skipIf(!linux)('keeps the host service identity hab verified on the running and the ended record, and omits a malformed one', async () => {
  // hab's prepare adapter verifies the host's identity token and hands the host only this projection (#34599).
  const previous = process.env.HAB_ACP_HOST_SERVICE_IDENTITY;
  try {
    process.env.HAB_ACP_HOST_SERVICE_IDENTITY = JSON.stringify({ sessionId: 'svc-34599', generation: 7 });
    const { session, prefix, log } = await start([]);
    const atInit = JSON.parse(String(initializes(log)[0]?.custodyRecord)) as Custody;
    expect(atInit).toMatchObject({ state: 'running', serviceSession: { sessionId: 'svc-34599', generation: 7 } });
    await session.close();
    await until(() => readCustody(prefix).state === 'ended');
    expect(readCustody(prefix).serviceSession).toEqual({ sessionId: 'svc-34599', generation: 7 });

    process.env.HAB_ACP_HOST_SERVICE_IDENTITY = JSON.stringify({ sessionId: 'svc-34599', generation: 0 });
    const bad = await start([]);
    const badAtInit = JSON.parse(String(initializes(bad.log)[0]?.custodyRecord)) as Custody;
    expect(badAtInit.state).toBe('running');
    expect(badAtInit.serviceSession).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.HAB_ACP_HOST_SERVICE_IDENTITY;
    else process.env.HAB_ACP_HOST_SERVICE_IDENTITY = previous;
  }
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

it.skipIf(!linux)('another process sees the seat locked while its child lives, and free once the end is recorded', async () => {
  // A second host process must not admit an opening while this host's child lives; the lock is the exclusion.
  const { session, prefix, log } = await start([]);
  const probe = (): string => execFileSync(process.execPath, [PROBE, `${prefix}.lock`], { encoding: 'utf8' });
  expect(probe()).toBe('held');
  const pid = Number(initializes(log)[0]?.pid);
  // The child never inherits the lock descriptor.
  const lockPath = `${prefix}.lock`;
  const { readdirSync, readlinkSync } = await import('node:fs');
  const childFds = readdirSync(`/proc/${pid}/fd`).map((fd) => { try { return readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { return ''; } });
  expect(childFds).not.toContain(lockPath);
  await session.close();
  await until(() => readCustody(prefix).state === 'ended');
  expect(probe()).toBe('free');
});
