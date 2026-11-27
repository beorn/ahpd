import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { posix } from '../../../tools/posix.ts';
import { acpAgent, connectAcp, watchSession } from '../src/index.js';
import * as connectionPort from '../src/connection.js';
import { createOpening } from '../src/session/opening.js';
import type { SessionContext } from '../src/session/context.js';
import type { AcpConnection, AcpOptions } from '../src/types.js';
import type { Spawn } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';

/*
 * A server that never starts, and one that exits mid-prompt.
 *
 * The command in the first case is a program that does not exist, which is
 * what a configuration naming an ACP server nobody installed looks like. Each
 * case also listens on the test process itself: an `error` event nobody heard
 * or a rejection nobody caught ends a daemon and every session on it, so
 * neither is allowed to reach it.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** A program name no machine has on its PATH. */
const MISSING = 'ahpd-no-such-acp-server';

/** What reached the process unheard while a case ran. */
const escaped: unknown[] = [];
const heard = (why: unknown): void => { escaped.push(why); };

const started: Session[] = [];

beforeEach(() => {
  escaped.length = 0;
  process.on('uncaughtException', heard);
  process.on('unhandledRejection', heard);
});

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  process.off('uncaughtException', heard);
  process.off('unhandledRejection', heard);
});

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

/** The host's retained custody record (#34599), or null when none was written. */
const custodyAt = (prefix: string): Bag | null => (existsSync(`${prefix}.custody`)
  ? JSON.parse(readFileSync(`${prefix}.custody`, 'utf8')) as Bag : null);
const childOf = (record: unknown): number | undefined => ((record as { child?: { pid?: number } | null } | null)?.child?.pid);
const gone = (pid: number): boolean => !existsSync(`/proc/${pid}`) || /^\d+ \(.*\) Z /su.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));

/** Lets `times` timer ticks pass, for a check that something did not happen. */
const pause = async (times: number): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 1); });
};

it.each(['refresh', 'inputs', 'dispose'] as const)('discards an old placement invalidated by %s without spawning or replacing its successor', async (invalidated) => {
  // 32996: the opening owner must revalidate after placement; subprocess tests cannot schedule this continuation.
  // The connection port only holds initialize pending. createOpening owns all identity and live-state decisions.
  const placements: ((spawn: Spawn) => void)[] = [];
  const handshakes: ((error: Error) => void)[] = [];
  let current: AcpOptions = { command: 'old-acp', provider: 'placement-race', honoursTrust: true };
  const ctx = {
    options: { ...current, presetOf: () => current },
    provider: 'placement-race', cwd: '/fixture', values: {}, replay: [], startedWith: '',
    syncConfig: () => {},
    start: {
      settings: { computer: 'computer://box' },
      computers: { how: () => new Promise<Spawn>((resolve) => { placements.push(resolve); }) },
    },
  } as unknown as SessionContext;
  const connected = vi.spyOn(connectionPort, 'connectAcp').mockImplementation(() => ({
    initialize: () => new Promise<Awaited<ReturnType<AcpConnection['initialize']>>>((_resolve, reject) => { handshakes.push(reject); }),
    ended: new Promise<void>(() => {}),
    close: async () => {},
  } as unknown as AcpConnection));
  const opening = createOpening(ctx, ctx.options);
  const pending: Promise<unknown>[] = [];
  try {
    opening.refreshOptions();
    pending.push(opening.open().catch((error: unknown) => error));
    await until(() => placements.length === 1);
    if (invalidated !== 'refresh') {
      if (invalidated === 'inputs') ctx.options.command = 'changed-during-placement';
      else ctx.disposed = true;
      placements[0]!({ command: 'old-acp', args: [] });
      await pause(2);
      expect(connected).not.toHaveBeenCalled();
      expect(await pending[0]).toBeInstanceOf(Error);
      expect(ctx.live).toBeUndefined();
      expect(ctx.loading).toBe(false);
      return;
    }
    current = { ...current, command: 'successor-acp' };
    opening.refreshOptions();
    const successor = opening.open();
    pending.push(successor.catch((error: unknown) => error));
    await until(() => placements.length === 2);
    placements[1]!({ command: 'successor-acp', args: [] });
    await until(() => connected.mock.calls.length === 1);
    const live = ctx.live;
    placements[0]!({ command: 'old-acp', args: [] });
    await pause(2);
    expect(connected).toHaveBeenCalledTimes(1);
    expect(ctx.live).toBe(live);
    expect(ctx.opening).toBe(successor);
    expect(ctx.loading).toBe(true);
  }
  finally {
    for (const reject of handshakes) reject(new Error('fixture finished'));
    await Promise.allSettled(pending);
    connected.mockRestore();
  }
});

it.each(['new', 'load', 'resume', 'fork'].flatMap((method) => ['refresh', 'dispose'].map((invalidated) => ({ method, invalidated }))))('a late successful native $method reply cannot overwrite the selected opening after $invalidated', async ({ method, invalidated }) => {
  // 32996: placement refusal alone misses an obsolete reply arriving after its successor completed.
  const replies: ((reply: { sessionId: string }) => void)[] = [];
  const handshake = vi.fn();
  const learned = vi.fn();
  let current: AcpOptions = { command: 'old-acp', provider: 'late-native', honoursTrust: true, hostTools: false };
  const ctx = {
    options: { ...current, presetOf: () => current }, provider: 'late-native', cwd: '/fixture',
    values: {}, replay: [], turns: method === 'fork' ? [{ id: 'cut' }] : [], title: 'Fixture', startedWith: '', keeping: Promise.resolve(),
    syncConfig: () => {}, learnModes: learned, learnConfigOptions: () => {}, learnModels: () => {},
    sendAsked: async () => {},
    // What an open publishes its configured MCP servers through (#38500 fix 4).
    servers: [], published: () => [], emit: () => {},
    start: { uri: 'ahp-session:/late-native', chatUri: 'ahp-chat:/selected', settings: {}, onHandshake: handshake,
      ...(method === 'new' ? {} : { resume: 'kept-native' }), ...(method === 'fork' ? { forkAt: 'cut' } : {}),
    },
  } as unknown as SessionContext;
  const reply = () => new Promise<{ sessionId: string }>((resolve) => { replies.push(resolve); });
  const connected = vi.spyOn(connectionPort, 'connectAcp').mockImplementation(() => ({
    initialize: async () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true,
      sessionCapabilities: { ...(method === 'resume' ? { resume: {} } : {}), ...(method === 'fork' ? { fork: {} } : {}) },
    } }),
    newSession: reply, loadSession: reply, resumeSession: reply, forkSession: reply,
    ended: new Promise<void>(() => {}), close: async () => {},
  } as unknown as AcpConnection));
  const opening = createOpening(ctx, ctx.options);
  const pending: Promise<unknown>[] = [];
  try {
    opening.refreshOptions();
    const old = opening.open().catch((error: unknown) => error);
    pending.push(old);
    await until(() => replies.length === 1);
    if (invalidated === 'refresh') {
      current = { ...current, command: 'current-acp' };
      opening.refreshOptions();
      const selected = opening.open();
      pending.push(selected);
      await until(() => replies.length === 2);
      replies[1]!({ sessionId: 'current-native' });
      expect((await selected).sessionId).toBe(method === 'load' || method === 'resume' ? 'kept-native' : 'current-native');
    }
    else ctx.disposed = true;
    replies[0]!({ sessionId: 'obsolete-native' });
    expect(await old).toBeInstanceOf(Error);
    expect(ctx.acpSessionId).toBe(invalidated === 'refresh' ? (method === 'load' || method === 'resume' ? 'kept-native' : 'current-native') : undefined);
    expect(handshake).toHaveBeenCalledTimes(invalidated === 'refresh' ? 1 : 0);
    expect(learned).toHaveBeenCalledTimes(invalidated === 'refresh' ? 1 : 0);
  }
  finally { connected.mockRestore(); await Promise.allSettled(pending); }
});

it.skipIf(process.platform !== 'linux')('catalog connections never publish custody for a managed backend', async () => {
  // 32996: catalog initialization is a real child connection, but never an actual selected opening.
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-catalog-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'custody-catalog', env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: 'ahp-session:/custody',
      HAB_ACP_CHAT_URI: 'ahp-chat:/original',
    } });
    const rows = await agent.list?.();
    expect(rows?.length).toBeGreaterThan(0);
    const requests = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Bag);
    expect(requests.some((request) => request.method === 'initialize')).toBe(true);
    expect(requests.some((request) => request.method === 'session/list')).toBe(true);
    // A catalog child is never admitted: no record and no lock (#34599).
    expect(existsSync(`${prefix}.custody`)).toBe(false);
    expect(existsSync(`${prefix}.lock`)).toBe(false);
    expect(existsSync(`${prefix}.pid`)).toBe(false);
    expect(existsSync(`${prefix}.stat`)).toBe(false);
  }
  finally { rmSync(folder, { recursive: true, force: true }); }
});

it.skipIf(process.platform !== 'linux').each([
  { kind: 'original', fact: true, selected: undefined },
  { kind: 'selected peer', fact: false, selected: 'ahp-chat:/original' },
  { kind: 'selected legacy', fact: undefined, selected: 'ahp-chat:/original' },
] as const)('records the selected actual child before initialize and keeps the record, ended, after close ($kind)', async ({ fact, selected }) => {
  // 32996: a child self-stamp is too late for initialization. Observe from the real subprocess at initialize.
  // 34599: the record outlives the child, so a stop can prove it ended.
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  const uri = 'ahp-session:/custody';
  let session: Session | undefined;
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE, '--observe-pid-custody'], provider: 'custody', env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: uri,
      ...(selected === undefined ? {} : { HAB_ACP_CHAT_URI: selected }),
    } });
    session = await agent.create({ uri, chatUri: 'ahp-chat:/original',
      ...(fact === undefined ? {} : { sessionConversation: fact }),
      clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
      settings: {}, workingDirectory: folder, trusted: () => true,
      schema: () => ({ type: 'object', properties: {} }), emit: () => {},
    });
    const observed = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Bag)
      .find((line) => line.method === 'fixture/pid-at-initialize');
    expect(observed).toBeDefined();
    const atInit = JSON.parse(String(observed?.custodyRecord)) as Bag;
    expect(atInit.state).toBe('running');
    expect(childOf(atInit)).toBe(observed?.pid);
    expect(observed?.pidRecord).toBeNull();
    expect(observed?.statRecord).toBeNull();
    expect(session.agentId()).toMatch(/^acp-session-/u);
    expect((session.chatState()._meta as Bag | undefined)?.['ahpd/backendSessionId']).toBe(session.agentId());
    await session.close();
    expect((session.chatState()._meta as Bag | undefined)?.['ahpd/backendSessionId']).toBeUndefined();
    await until(() => custodyAt(prefix)?.state === 'ended');
    expect(custodyAt(prefix)).toMatchObject({ opening: atInit.opening, child: atInit.child });
    expect(existsSync(`${prefix}.pid`)).toBe(false);
    expect(existsSync(`${prefix}.stat`)).toBe(false);
  }
  finally { await session?.close(); rmSync(folder, { recursive: true, force: true }); }
});

it.skipIf(process.platform !== 'linux').each([
  { kind: 'other session', uri: 'ahp-session:/other', fact: true, selected: undefined },
  { kind: 'other selected chat', uri: 'ahp-session:/custody', fact: true, selected: 'ahp-chat:/other' },
  { kind: 'unselected peer', uri: 'ahp-session:/custody', fact: false, selected: undefined },
  { kind: 'unknown legacy', uri: 'ahp-session:/custody', fact: undefined, selected: undefined },
] as const)('fails custody without selecting another conversation ($kind)', async ({ uri, fact, selected }) => {
  // 32996: explicit full URIs or recorded original provenance are required; chatId/default never grant authority.
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  const actions: Bag[] = [];
  let session: Session | undefined;
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'custody', env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: 'ahp-session:/custody',
      ...(selected === undefined ? {} : { HAB_ACP_CHAT_URI: selected }),
    } });
    await expect(agent.create({ uri, chatUri: 'ahp-chat:/original',
      ...(fact === undefined ? {} : { sessionConversation: fact }),
      clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
      trusted: () => true, schema: () => ({ type: 'object', properties: {} }),
      emit: (_channel, action) => { actions.push(action as Bag); },
    })).rejects.toThrow('no matching configured ACP process authority');
    expect(existsSync(log)).toBe(false);
    expect(existsSync(`${prefix}.custody`)).toBe(false);
    expect(existsSync(`${prefix}.pid`)).toBe(false);
    expect(existsSync(`${prefix}.stat`)).toBe(false);
    expect(actions.some((action) => action.type === 'chat/turnStarted')).toBe(false);
  }
  finally { await session?.close(); rmSync(folder, { recursive: true, force: true }); }
});

it.skipIf(process.platform !== 'linux')('a second opening of the same seat refuses while the first child lives, and the record still names it', async () => {
  // 32996: the same prefix can outlive an old connection's asynchronous close.
  // 34599: one seat has one child: a second opening waits out the bound, then refuses and spawns nothing.
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  const uri = 'ahp-session:/custody';
  const sessions: Session[] = [];
  const actions: Bag[] = [];
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'custody', killGraceMs: 100, env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: uri,
    } });
    const opening: Start = { uri, chatUri: 'ahp-chat:/original', sessionConversation: true,
      clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
      trusted: () => true, schema: () => ({ type: 'object', properties: {} }), emit: (_channel, action) => { actions.push(action as Bag); },
    };
    sessions.push(await agent.create(opening));
    const first = custodyAt(prefix);
    const pid = childOf(first);
    expect(first?.state).toBe('running');
    let refused: unknown;
    try {
      sessions.push(await agent.create(opening));
      sessions[1]!.sendMessage('t1', 'hello');
      await until(() => failure(actions) !== undefined, 10_000);
    }
    catch (error) { refused = error; }
    expect(String(refused ?? failure(actions))).toContain('did not become available');
    expect(custodyAt(prefix)).toEqual(first);
    expect(gone(pid!)).toBe(false);
    expect(readFileSync(log, 'utf8').trim().split('\n').filter((line) => line.includes('"method":"initialize"')).length).toBe(1);
    await sessions[0]!.close();
    await until(() => custodyAt(prefix)?.state === 'ended');
    expect(childOf(custodyAt(prefix))).toBe(pid);
  }
  finally { for (const session of sessions) await session.close(); rmSync(folder, { recursive: true, force: true }); }
}, 20_000);

it.skipIf(process.platform !== 'linux').each(['initialize', 'session/new', 'session/load', 'bookkeeping', 'load-bookkeeping'] as const)(
  'a failed %s records its own child ended', async (method) => {
    // 32996: close success does not exercise the three opening failure paths after publication.
    // 34599: the failure keeps the record and the lock until its child has ended, then records that end.
    const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-failure-'));
    const prefix = join(folder, 'child');
    const log = join(folder, 'requests.jsonl');
    let session: Session | undefined;
    let bookkeepingPair: Bag | undefined;
    const bookkeeping = method === 'bookkeeping' || method === 'load-bookkeeping';
    try {
      const agent = acpAgent({ command: process.execPath, args: [FIXTURE, `--fail-method=${method}`], provider: 'custody-failure', env: {
        ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: 'ahp-session:/custody',
      } });
      let refused: unknown;
      try {
        session = await agent.create({ uri: 'ahp-session:/custody', chatUri: 'ahp-chat:/original', sessionConversation: true,
          ...(method === 'session/load' || method === 'load-bookkeeping' ? { resume: 'recorded-backend-id' } : {}),
          ...(bookkeeping ? { onHandshake: () => {
            const custodyRecord = readFileSync(`${prefix}.custody`, 'utf8');
            bookkeepingPair = { pid: childOf(JSON.parse(custodyRecord)), custodyRecord };
            throw new Error('fixture refused bookkeeping');
          } } : {}),
          clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
          trusted: () => true, schema: () => ({ type: 'object', properties: {} }), emit: () => {},
        });
      } catch (error) { refused = error; }
      const requests = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Bag);
      expect(requests.some((request) => request.method === (method === 'load-bookkeeping' ? 'session/load' : method === 'bookkeeping' ? 'session/new' : method))).toBe(true);
      const observed = bookkeepingPair ?? requests.find((request) => request.method === 'fixture/pid-at-failure');
      expect(observed).toBeDefined();
      const seen = JSON.parse(String(observed?.custodyRecord)) as Bag;
      expect(seen.state).toBe('running');
      expect(childOf(seen)).toBe(observed?.pid);
      await until(() => custodyAt(prefix)?.state === 'ended');
      expect(custodyAt(prefix)).toMatchObject({ opening: seen.opening, child: seen.child });
      expect(existsSync(`${prefix}.pid`)).toBe(false);
      expect(existsSync(`${prefix}.stat`)).toBe(false);
      expect((session?.chatState()._meta as Bag | undefined)?.['ahpd/backendSessionId']).toBeUndefined();
      expect(session).toBeUndefined();
      expect(String(refused)).toContain(`fixture refused ${bookkeeping ? 'bookkeeping' : method}`);
      if (method === 'load-bookkeeping') {
        expect(requests.find((request) => request.method === 'session/load')?.params).toMatchObject({ sessionId: 'recorded-backend-id' });
      }
    }
    finally { await session?.close(); rmSync(folder, { recursive: true, force: true }); }
  },
);

it.skipIf(process.platform !== 'linux')('an unreadable custody record refuses the opening and spawns nothing', async () => {
  // 34599: under the lock, a record that proves nothing about an earlier child is never read as "ended".
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-custody-'));
  const prefix = join(folder, 'child');
  const log = join(folder, 'requests.jsonl');
  writeFileSync(`${prefix}.custody`, '{"v":1,"state":"running"');
  const actions: Bag[] = [];
  let session: Session | undefined;
  try {
    const agent = acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'custody', env: {
      ACP_LOG: log, HAB_ACP_PID_PREFIX: prefix, HAB_ACP_SESSION_URI: 'ahp-session:/custody',
    } });
    let refused: unknown;
    try {
      session = await agent.create({ uri: 'ahp-session:/custody', chatUri: 'ahp-chat:/original', sessionConversation: true,
        clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
        trusted: () => true, schema: () => ({ type: 'object', properties: {} }), emit: (_channel, action) => { actions.push(action as Bag); },
      });
      session.sendMessage('t1', 'hello');
      await until(() => failure(actions) !== undefined);
    }
    catch (error) { refused = error; }
    expect(String(refused ?? failure(actions))).toContain('custody record is unreadable');
    expect(existsSync(log)).toBe(false);
    expect(readFileSync(`${prefix}.custody`, 'utf8')).toBe('{"v":1,"state":"running"');
  }
  finally { await session?.close(); rmSync(folder, { recursive: true, force: true }); }
});

/** A session of `command`, with every action it emits kept, and every line the agent logs. */
async function start(
  command: string,
  args: string[] = [],
  stderrTail?: 'sentence' | 'log',
): Promise<{ session: Session; actions: Bag[]; logged: string[] }> {
  const actions: Bag[] = [];
  const logged: string[] = [];
  const agent = acpAgent({
    command,
    args,
    provider: 'acp-failure',
    log: (line) => { logged.push(line); },
    ...(stderrTail === undefined ? {} : { stderrTail }),
  });
  const opening: Start = {
    uri: 'ahp-session:/failure',
    chatUri: 'ahp-chat:/failure',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    // What this case is about is the command, and an absent trust answer is
    // untrusted - decision `a-folder-is-untrusted-until-a-client-says-
    // otherwise` - so the folder is one the host vouched for.
    trusted: () => true,
  };
  const session = await agent.create(opening);
  started.push(session);
  return { session, actions, logged };
}

/** The message on the `chat/error` that ended a turn, once one has. */
const failure = (actions: Bag[]): string | undefined => {
  const error = actions.find((action) => action.type === 'chat/error') as
    { part?: { error?: { message?: string } } } | undefined;
  return error?.part?.error?.message;
};

it('rejects opening when the command is missing, and nothing escapes', async () => {
  await expect(start(MISSING)).rejects.toThrow(`${MISSING} was not found`);
  // An explicit later open fails independently; no fabricated session accepts a turn.
  await expect(start(MISSING)).rejects.toThrow(`${MISSING} was not found`);
  expect(escaped).toEqual([]);
});

/*
 * Upstream says this on the first turn's error. This fork opens the server
 * before a session is answered and refuses the creation with what the open
 * met (322b91d98), so the creation's refusal is where the person reads it: the
 * sentence names what was run and the PATH it ran with, and the trace the
 * server left (#463 sync).
 */

/** The message a creation that could not open its server is refused with. */
const refusedWith = async (opening: Promise<unknown>): Promise<string> => {
  const error = await opening.then(() => undefined, (why: unknown) => why);
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
};

it('refuses the creation of a session whose command is missing, naming the command and its PATH', async () => {
  const said = await refusedWith(start(MISSING));
  expect(said).toContain(MISSING);
  expect(said).toContain(`${MISSING} was started with PATH ${process.env.PATH}`);
  expect(escaped).toEqual([]);
});

it('refuses the creation of a session whose adapter cannot start its own backend, with what it wrote on stderr', async () => {
  const said = await refusedWith(start(process.execPath, [FIXTURE, '--startup-fails']));
  expect(said).toContain('startup failed: claude --version: Executable not found in $PATH');
  expect(said).toContain(`${process.execPath} was started with PATH ${process.env.PATH}`);
  expect(said).toContain('spawn claude ENOENT');
  expect(escaped).toEqual([]);
});

// Windows has no SIGTERM to outlast: the server is ended as it is closed.
it.skipIf(process.platform === 'win32')('carries what a refused open\'s server wrote on stderr after its answer', async () => {
  const said = await refusedWith(start(process.execPath, [FIXTURE, '--startup-fails', '--why-last']));
  expect(said).toContain('startup failed');
  expect(said).toContain('spawn claude ENOENT');
  expect(escaped).toEqual([]);
});

it('keeps the PATH and the trace out of the error, where the record leaves the trace to the log', async () => {
  const said = await refusedWith(start(process.execPath, [FIXTURE, '--startup-fails'], 'log'));
  expect(said).toContain('startup failed');
  expect(said).not.toContain('was started with PATH');
  expect(said).not.toContain('spawn claude ENOENT');
  expect(escaped).toEqual([]);
});

/**
 * A server that cannot start, through the host: the session is never ready.
 * This fork opens the server inside `createSession`, so the request itself is
 * refused with why (#463 sync; upstream fails it later, as `creationFailed`).
 */
it('fails the creation of a session on a host whose adapter cannot start its own backend', async () => {
  const told: { type: string; message: string }[] = [];
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE, '--startup-fails'], provider: 'acp-failure', honoursTrust: true });
  const host = createHost({ path: process.cwd(), agents: [agent] });
  const client = host.accept({
    send: () => {},
    notify: (method, params) => {
      if (method !== 'action') return;
      const { action } = params as { action: Bag };
      const error = (action.error ?? (action.part as Bag | undefined)?.error ?? {}) as Bag;
      told.push({ type: String(action.type), message: String(error.message ?? '') });
    },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  });
  try {
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
    const uri = 'ahp-session:/cannot-start';
    await expect(client.handle({ method: 'createSession', params: { channel: uri, provider: 'acp-failure' } })).rejects.toThrow('startup failed');

    expect(told.some((one) => one.type === 'session/ready')).toBe(false);
    expect(escaped).toEqual([]);
  }
  finally {
    await host.close();
  }
});

it('resolves the send once the server holds the session', async () => {
  const { session, actions } = await start(process.execPath, [FIXTURE]);
  await (session.sendMessage('t1', 'hello') as Promise<void>);

  expect(failure(actions)).toBeUndefined();
  expect(escaped).toEqual([]);
});

it('rejects the handshake with a sentence naming a missing command', async () => {
  const connection = connectAcp({ command: MISSING, handlers: { update: () => {} } });
  await expect(connection.initialize()).rejects.toThrow(`${MISSING} was not found`);
  connection.close();
  await pause(20);
  expect(escaped).toEqual([]);
});

/*
 * A backend with no kept session lists on the host, and its command may exist
 * only in a machine. One failure says nothing about the server, so the read
 * answers from the watched rows with one line, and the record does not spawn
 * and fail again at every listing: it tries again after a wait that doubles
 * from a minute, so a command that comes back is listed again (#37753).
 */
it('answers the watched rows after a listing whose command is missing, with one line, and tries again after the wait', async () => {
  watchSession({ provider: 'acp-missing-list', id: 'kept', cwd: '/tmp', additional: [], title: 'Kept' });
  const lines: string[] = [];
  const agent = acpAgent({ command: MISSING, provider: 'acp-missing-list', log: (line) => { lines.push(line); } });

  await expect(agent.list?.()).resolves.toMatchObject([{ id: 'kept' }]);
  const failed = (): string[] => lines.filter((line) => line.startsWith('acp-missing-list:'));
  expect(failed()).toEqual([expect.stringMatching(/^acp-missing-list: server ended before initialize \(.* was not found.*\); next spawn attempt in 1 min$/u)]);

  // Inside the wait the same record answers from the same rows, and tries no second time.
  await expect(agent.list?.()).resolves.toMatchObject([{ id: 'kept' }]);
  expect(failed()).toHaveLength(1);

  // After it, one more try, and the wait doubles.
  try {
    later(MINUTE + 1);
    await expect(agent.list?.()).resolves.toMatchObject([{ id: 'kept' }]);
    expect(failed()).toHaveLength(2);
    expect(failed()[1]).toMatch(/next spawn attempt in 2 min$/u);
  }
  finally {
    vi.restoreAllMocks();
  }
  await pause(20);
  expect(escaped).toEqual([]);
});

/*
 * #37753: a record that keeps sessions is listed by the host at every pass (it
 * passes the record's machines, none here), so a host server that dies before
 * it answers the handshake - its env file gone, its command exiting at once -
 * was spawned, and its failure logged, at every pass. Inside the wait after a
 * death the read is answered with that death and nothing is spawned; the wait
 * doubles from a minute up to fifteen, and a changed input or a listing that
 * answers clears it, so a failure that heals heals by itself.
 */
const MINUTE = 60_000;
const later = (ms: number): void => {
  const now = Date.now() + ms;
  vi.spyOn(Date, 'now').mockReturnValue(now);
};
const spawnsIn = (file: string): number => (existsSync(file) ? readFileSync(file, 'utf8').length : 0);

it('logs one line, not one per pass, for a record that keeps sessions and whose env file is gone', async () => {
  const lines: string[] = [];
  const goneEnv = `--env-file=/nonexistent/ahpd-37753-${process.pid}.provider-env`;
  const agent = acpAgent({ command: process.execPath, args: [goneEnv, FIXTURE], provider: 'acp-gone-env', log: (line) => { lines.push(line); } });
  for (let passes = 0; passes < 3; passes += 1) await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
  expect(lines.filter((line) => line.startsWith('acp-gone-env:'))).toEqual([
    `acp-gone-env: server ended before initialize (${process.execPath} exited with code 9); next spawn attempt in 1 min`,
  ]);
  await pause(20);
  expect(escaped).toEqual([]);
});

it('spawns a died-before-handshake host server again only after a doubling wait, at once on a changed input, and resets on an answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-37753-'));
  const counter = join(dir, 'spawns');
  const healed = join(dir, 'healed');
  // Counts each spawn, then dies at once unless `healed` exists, when it runs the fixture server.
  const script = join(dir, 'server.mjs');
  writeFileSync(script, [
    `import { appendFileSync, existsSync } from 'node:fs';`,
    `appendFileSync(${JSON.stringify(counter)}, 'x');`,
    `if (!existsSync(${JSON.stringify(healed)})) process.exit(9);`,
    `await import(${JSON.stringify(FIXTURE)});`,
  ].join('\n'));
  const lines: string[] = [];
  const options = { command: process.execPath, args: [script], provider: 'acp-dies-early', log: (line: string) => { lines.push(line); } };
  const agent = acpAgent(options);
  const waits = (): string[] => lines.filter((line) => line.includes('next spawn attempt')).map((line) => line.replace(/.*attempt in /u, ''));
  try {
    await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
    await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
    expect(spawnsIn(counter)).toBe(1);
    later(MINUTE + 1);
    await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
    expect(spawnsIn(counter)).toBe(2);
    expect(waits()).toEqual(['1 min', '2 min']);
    // The record is edited in place (channel.ts: an edit updates the view `open` was handed): spawned at once.
    options.args = [script, '--edited'];
    await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
    expect(spawnsIn(counter)).toBe(3);
    expect(waits()).toEqual(['1 min', '2 min', '1 min']);
    // Healed after the wait: the listing answers, and the next death waits a minute again, not two.
    writeFileSync(healed, '');
    vi.restoreAllMocks();
    later(2 * MINUTE + 2);
    await expect(agent.list?.([], true)).resolves.toBeDefined();
    expect(spawnsIn(counter)).toBe(4);
    rmSync(healed);
    await pause(50);
    await expect(agent.list?.([], true)).rejects.toThrow('exited with code 9');
    expect(waits()).toEqual(['1 min', '2 min', '1 min', '1 min']);
  }
  finally {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('fails the turn with the exit code when the server exits mid-prompt', async () => {
  const { session, actions } = await start(process.execPath, [FIXTURE]);
  session.sendMessage('t1', 'die now');
  await until(() => failure(actions) !== undefined);

  expect(failure(actions)).toContain('exited with code 3');
  expect(escaped).toEqual([]);
});

it('fails the turn as a failed send with what the server wrote on stderr before it died, and logs it', async () => {
  const { session, actions, logged } = await start(process.execPath, [FIXTURE]);
  session.sendMessage('t1', 'be noisy');
  await until(() => failure(actions) !== undefined && logged.some((line) => line.includes('backend.js:41')));

  // The error a client is shown is the failure's own, typed by the stage VS
  // Code's host names for a send that failed, with the trace under it, since
  // a person on a client cannot read the daemon's log; the trace went to the
  // log as well, as VS Code's agents log a runtime's stderr.
  const error = (actions.find((action) => action.type === 'chat/error') as { part?: { error?: Bag } } | undefined)?.part?.error;
  expect(error?.errorType).toBe('sendFailed');
  expect(failure(actions)).toContain('exited with code 4');
  expect(failure(actions)).toContain('the model backend refused the request');
  expect(failure(actions)).toContain('at Backend.send (backend.js:41)');
  expect(logged.join('\n')).toContain('stderr: the model backend refused the request');
  expect(logged.join('\n')).toContain('stderr:     at Backend.send (backend.js:41)');
  expect(escaped).toEqual([]);
});

it('never surfaces the stderr of a server that answered, and logs it', async () => {
  const { session, actions, logged } = await start(process.execPath, [FIXTURE]);
  session.sendMessage('t1', 'chatter a little');
  await until(() => actions.some((action) => action.type === 'chat/turnComplete') && logged.length > 0);

  // The line went to the log and stayed there: a client hears nothing of a
  // server's own output.
  expect(actions.some((action) => action.type === 'chat/error')).toBe(false);
  expect(JSON.stringify(actions)).not.toContain('a line the server said to nobody');
  expect(logged.some((line) => line.endsWith('stderr: a line the server said to nobody'))).toBe(true);
  expect(escaped).toEqual([]);
});

/*
 * A record whose `stderrTail` is `log` leaves the trace to the log, as VS
 * Code's agents log a runtime's stderr, and the error a client is shown is the
 * failure's own words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2716
 */
it('leaves the stderr to the log when the record says stderrTail log', async () => {
  const { session, actions, logged } = await start(process.execPath, [FIXTURE], 'log');
  session.sendMessage('t1', 'be noisy');
  await until(() => failure(actions) !== undefined && logged.some((line) => line.includes('backend.js:41')));

  expect(failure(actions)).toContain('exited with code 4');
  expect(failure(actions)).not.toContain('the model backend refused the request');
  expect(logged.join('\n')).toContain('stderr: the model backend refused the request');
  expect(escaped).toEqual([]);
});

it('keeps the last 8 KB of stderr, cut at a line boundary', async () => {
  const lines = Array.from({ length: 2000 }, (_one, at) => `line ${String(at)}`);
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', `process.stderr.write(${JSON.stringify(lines.join('\n'))}, () => { process.exit(5); });`],
    handlers: { update: () => {} },
  });
  await expect(connection.initialize()).rejects.toThrow('exited with code 5');
  const tail = await connection.stderrTail();

  expect(tail.length).toBeLessThanOrEqual(8 * 1024);
  // The oldest line went, and what is left begins at a whole one rather than at
  // the middle of it.
  expect(tail).not.toContain('line 0\n');
  expect(tail.split('\n')[0]).toMatch(/^line \d+$/);
  expect(tail.endsWith('line 1999')).toBe(true);
  await connection.close();
});

it('keeps as much of the stderr as the record\'s stderrBytes names', async () => {
  const lines = Array.from({ length: 2000 }, (_one, at) => `line ${String(at)}`);
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', `process.stderr.write(${JSON.stringify(lines.join('\n'))}, () => { process.exit(5); });`],
    handlers: { update: () => {} },
    stderrBytes: 1024,
  });
  await expect(connection.initialize()).rejects.toThrow('exited with code 5');
  const tail = await connection.stderrTail();
  expect(tail.length).toBeLessThanOrEqual(1024);
  expect(tail.endsWith('line 1999')).toBe(true);
  await connection.close();
});

/*
 * #38705: the silence bound.
 *
 * A server that greets and then says nothing is not a slow server: the turn
 * waiting on it has been taken and can never begin, and nothing in the protocol
 * ends such a turn. The bound is on silence rather than on time, so a session
 * read back from a long conversation - which streams its replay the whole way -
 * is never cut short, and the failure is said in words that name the step.
 */

/** A server that answers its handshake and then does what it was told for the next call. */
const quietServer = (after: string): string => `
const send = (one) => process.stdout.write(JSON.stringify(one) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (blob) => {
  for (const line of blob.split('\\n')) {
    if (line.trim() === '') continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1', agentCapabilities: {} } });
      continue;
    }
    if (message.method === 'session/new') { ${after} }
  }
});
`;

it('fails a handshake the server never answers, naming the step', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);'],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await expect(connection.initialize()).rejects.toThrow('sent nothing for 150 ms during the handshake; nothing ran');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
});

it('fails a server that greets and then goes quiet on session/new', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', quietServer('')],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await expect(connection.newSession({ cwd: '/', mcpServers: [] } as never))
      .rejects.toThrow('sent nothing for 150 ms during session/new; nothing ran');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
});

it('keeps waiting on a server that keeps talking, however long the call takes', async () => {
  // Twelve updates forty milliseconds apart: past the bound in total, never
  // quiet for as long as it. A replay that streams is working, not stuck.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', quietServer(`
      let left = 12;
      const tick = () => {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'part' } } } });
        if (--left === 0) {
          send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 's' } });
          return;
        }
        setTimeout(tick, 40);
      };
      tick();`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    const began = Date.now();
    const answer = await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    expect(answer.sessionId).toBe('s');
    expect(Date.now() - began).toBeGreaterThan(150);
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('waits for ever where the record turns the silence bound off', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', quietServer('')],
    handlers: { update: () => {} },
    startAnswerMs: 0,
  });
  try {
    await connection.initialize();
    const call = connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const outcome = await Promise.race([
      call.then(() => 'answered', () => 'failed'),
      new Promise((resolve) => { setTimeout(() => resolve('waiting'), 400); }),
    ]);
    expect(outcome).toBe('waiting');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

/*
 * #38786: the silence bound covers the prompt too.
 *
 * Two live turns were taken, began (`promptBegun`), and then heard nothing at
 * all: the server never answered `session/prompt` and never sent an update, so
 * the host held each turn as running for ever while the gateway gave up on it.
 * The rule is the opening's rule - a server that owes an answer and has gone
 * quiet fails, by name - with one difference a prompt needs: while the server
 * is waiting on this client (a person deciding a permission, a terminal it was
 * told to wait for), its silence is ours and does not count.
 */

/** A server that opens a session `s` and then does what it was told with the prompt. */
const promptServer = (onPrompt: string, onAnswer = ''): string => `
const send = (one) => process.stdout.write(JSON.stringify(one) + '\\n');
let prompt;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (blob) => {
  for (const line of blob.split('\\n')) {
    if (line.trim() === '') continue;
    const message = JSON.parse(line);
    if (message.method === undefined && message.id !== undefined) { ${onAnswer} continue; }
    if (message.id === undefined) continue;
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1', agentCapabilities: {} } });
      continue;
    }
    if (message.method === 'session/new') { send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 's' } }); continue; }
    if (message.method === 'session/prompt') { prompt = message; ${onPrompt} }
  }
});
`;

it('fails a prompt the server goes quiet on, naming the step', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer('')],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow('sent nothing for 150 ms during session/prompt');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('gives a prompt that has begun to answer ten times the bound before it ends it', async () => {
  // One chunk, then quiet for three times the opening bound: a model thinking, not a dead turn.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } } } });
      setTimeout(() => { send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } }); }, 450);`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('ends a prompt that went quiet for ten times the bound after it began', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } } } });`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const began = Date.now();
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow('sent nothing for 1500 ms during session/prompt; the turn is ended');
    expect(Date.now() - began).toBeGreaterThanOrEqual(1450);
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('keeps a prompt whose server keeps streaming, however long the turn takes', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      let left = 12;
      const tick = () => {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'part' } } } });
        if (--left === 0) {
          send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });
          return;
        }
        setTimeout(tick, 40);
      };
      tick();`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const began = Date.now();
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
    expect(Date.now() - began).toBeGreaterThan(150);
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('does not count the time a tool the server is running takes', async () => {
  // A build of the server's own, quiet for longer than the bound, then over.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'build', status: 'in_progress' } } });
      setTimeout(() => {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'completed' } } });
        send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });
      }, 450);`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('fails a prompt that goes quiet once its tool is over', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'build', status: 'in_progress' } } });
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'completed' } } });`)],
    handlers: { update: () => {} },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    // It had begun to answer, so it is held to the longer bound.
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow('sent nothing for 1500 ms during session/prompt');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('does not count the time a prompt waits on this client', async () => {
  // The server asks a permission and says nothing until it has the answer,
  // which a person takes longer than the bound to give.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(
      `send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 's', toolCall: { toolCallId: 't', title: 'edit' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }] } });`,
      `if (message.id === 900) send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });`,
    )],
    handlers: {
      update: () => {},
      permission: () => new Promise((resolve) => { setTimeout(() => resolve({ optionId: 'ok' }), 450); }),
    },
    startAnswerMs: 150,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

/*
 * #38919: the last-resort bound.
 *
 * The opening bound stops once a call has spoken, the turn bound is skipped while an open tool call or a request this
 * client owes the server is in flight, and a tool call's own clock is armed only while nothing is owed - so each of
 * the three can be disarmed at once and leave a turn running with no clock at all. Measured: one hosted seat held a
 * turn open for 2 h 15 m at 0.0% CPU with no line anywhere saying why. One clock is therefore always armed, and only
 * progress - a chunk, an update, or a request this client owes settling - restarts it.
 */

it('ends a turn whose only open thing is a tool call no clock is timing', async () => {
  // The call is open, so the turn bound is disarmed; its own 900 s clock is what a last resort backs up.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'build', status: 'in_progress' } } });`)],
    handlers: { update: () => {} },
    startAnswerMs: 5_000,
    lastResortMs: 200,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow(/the turn made no progress for 200 ms during session\/prompt - still open: "build" for \d+ ms; so the turn is ended/);
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('ends a turn whose only open thing is a request this client never answered', async () => {
  // A permission nobody decides: this client owes the server, so no clock of the server's own runs.
  let answered!: () => void;
  const decided = new Promise<{ optionId: string }>((resolve) => {
    answered = () => { resolve({ optionId: 'ok' }); };
  });
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(
      `send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 's', toolCall: { toolCallId: 't', title: 'edit' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }] } });`,
    )],
    handlers: { update: () => {}, permission: () => decided },
    startAnswerMs: 5_000,
    lastResortMs: 200,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow(/the turn made no progress for 200 ms during session\/prompt - still open: session\/request_permission; so the turn is ended/);
  }
  finally {
    await connection.close();
    answered();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('names every open thing when the last-resort bound ends a turn', async () => {
  const logged: string[] = [];
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(`
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'build', status: 'in_progress' } } });
      send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 's', toolCall: { toolCallId: 'b', title: 'build' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }] } });`)],
    handlers: { update: () => {}, permission: () => new Promise(() => {}) },
    log: (line) => { logged.push(line); },
    startAnswerMs: 5_000,
    lastResortMs: 200,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    await expect(connection.prompt('s', [{ type: 'text', text: 'hello' }]))
      .rejects.toThrow(/still open: "build" for \d+ ms, session\/request_permission; so the turn is ended/);
    // Said when the state is entered, and again when the permission joins the tool call - never twice for the same
    // set, and never silently.
    const said = logged.filter((line) => line.includes('only the last-resort clock runs'));
    expect(said).toHaveLength(2);
    expect(said[0]).toContain('still open: "build" for');
    expect(said[0]).not.toContain('session/request_permission');
    expect(said[1]).toMatch(/"build" for \d+ ms, session\/request_permission; the turn ends after 200 ms without progress/);
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

it('restarts the last-resort bound when a permission is decided at the last minute', async () => {
  // Decided two thirds of the way through the bound, then the server thinks for most of another one: without the
  // answer counting as progress the clock armed at the permission request would end this turn.
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(
      `send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 's', toolCall: { toolCallId: 't', title: 'edit' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }] } });`,
      `if (message.id === 900) setTimeout(() => { send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } }); }, 350);`,
    )],
    handlers: {
      update: () => {},
      permission: () => new Promise((resolve) => { setTimeout(() => resolve({ optionId: 'ok' }), 400); }),
    },
    startAnswerMs: 5_000,
    lastResortMs: 600,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  expect(escaped).toEqual([]);
}, 15_000);

/*
 * #39045 (@cto 2026-11-27): a request this client owes the server carries its
 * own bound, armed where it opens and cleared by its answer. While one is open
 * no clock of the server's own runs, so before this the only clock left was
 * the sixty-minute last resort: a permission nobody decided cost up to an hour
 * and then ended the turn, and the work it had done with it. Now that request
 * is itself answered, with an error naming the method and the wait, and the
 * agent goes on from it. The hour stays as the outer last resort.
 */

/** A server that asks for one permission, and then says on its own wire what came back. */
const askingServer = `
      send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 's', toolCall: { toolCallId: 't', title: 'edit' }, options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }] } });`;
const askedBack = `
      if (message.id === 900) {
        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wire:' + (message.error === undefined ? 'result' : message.error.message) } } } });
        send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });
      }`;

it('answers an unanswered request with a typed error at its own bound, and the turn goes on', async () => {
  const said: string[] = [];
  const logged: string[] = [];
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(askingServer, askedBack)],
    handlers: {
      update: (_sessionId, update) => {
        const text = (update as { content?: { text?: string } }).content?.text;
        if (text !== undefined) said.push(text);
      },
      permission: () => new Promise(() => {}),
    },
    log: (line) => { logged.push(line); },
    startAnswerMs: 500,
    lastResortMs: 30_000,
    toolRequestBoundMs: 2_000,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    // Resolved, not rejected: the server ended this turn once its request was answered.
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  // The request was answered on the wire, by name, with the typed error.
  expect(said).toHaveLength(1);
  expect(said[0]).toMatch(/^wire:tool request session\/request_permission got no reply in \d+ ms$/);
  // Said once when it outlived the normal idle bound, and once at expiry - never silently, never per chunk.
  expect(logged.filter((line) => /still open after \d+ ms/.test(line))).toHaveLength(1);
  expect(logged.filter((line) => /got no reply in \d+ ms, so that error is its answer/.test(line))).toHaveLength(1);
  // And no clock ended the turn: the only line naming the outer last resort says what it would do, not that it did.
  expect(logged.filter((line) => /so the turn is ended/.test(line))).toEqual([]);
  expect(escaped).toEqual([]);
}, 15_000);

it('clears a request answered inside its bound, and says nothing about it', async () => {
  const logged: string[] = [];
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(askingServer, `
      if (message.id === 900) send({ jsonrpc: '2.0', id: prompt.id, result: { stopReason: 'end_turn' } });`)],
    handlers: {
      update: () => {},
      permission: () => new Promise((resolve) => { setTimeout(() => resolve({ optionId: 'ok' }), 50); }),
    },
    log: (line) => { logged.push(line); },
    startAnswerMs: 5_000,
    lastResortMs: 30_000,
    toolRequestBoundMs: 2_000,
  });
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  // Answered inside its bound: the error was never armed and nothing was said about a wait.
  expect(logged.filter((line) => /got no reply|still open after/.test(line))).toEqual([]);
  expect(escaped).toEqual([]);
}, 15_000);

it('uses the per-method bound where the record names one', async () => {
  const said: string[] = [];
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', promptServer(askingServer, askedBack)],
    handlers: {
      update: (_sessionId, update) => {
        const text = (update as { content?: { text?: string } }).content?.text;
        if (text !== undefined) said.push(text);
      },
      permission: () => new Promise(() => {}),
    },
    startAnswerMs: 5_000,
    lastResortMs: 30_000,
    toolRequestBoundMs: 10_000,
    toolRequestBounds: { 'session/request_permission': 100 },
  });
  const began = Date.now();
  try {
    await connection.initialize();
    await connection.newSession({ cwd: '/', mcpServers: [] } as never);
    const answer = await connection.prompt('s', [{ type: 'text', text: 'hello' }]);
    expect(answer.stopReason).toBe('end_turn');
  }
  finally {
    await connection.close();
  }
  // Well inside the ten seconds the default would have taken: this method's own bound decided it.
  expect(Date.now() - began).toBeLessThan(3_000);
  expect(said[0]).toMatch(/^wire:tool request session\/request_permission got no reply in \d+ ms$/);
  expect(escaped).toEqual([]);
}, 15_000);

// A Node server cannot close its stdout on Windows while it keeps running:
// libuv's stdout holds a copy of the pipe handle, and fs.closeSync(1) skips
// fds 0-2, so the parent never reads an end. On POSIX, end() shuts the socket.
it.skipIf(!posix)('waits the record\'s exitGraceMs for the exit of a server that closed its stream', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', 'process.stdout.end(); setInterval(() => {}, 1000);'],
    handlers: { update: () => {} },
    exitGraceMs: 50,
  });
  try {
    const began = Date.now();
    await expect(connection.initialize()).rejects.toThrow();
    // Well inside the 1000 ms a record that names none waits.
    expect(Date.now() - began).toBeLessThan(800);
  }
  finally {
    await connection.close();
  }
});

it('kills a server that takes no SIGTERM once the record\'s killGraceMs has passed', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    handlers: { update: () => {} },
    killGraceMs: 100,
  });
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  const began = Date.now();
  await connection.close();
  // Well inside the 5000 ms a record that names none grants.
  expect(Date.now() - began).toBeLessThan(2_000);
}, 15_000);

it('settles a close once the server process has gone, and never rejects', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', "process.stdin.resume(); process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 100); });"],
    handlers: { update: () => {} },
  });
  let gone = false;
  void connection.ended.then(() => { gone = true; });
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  await connection.close();
  expect(gone).toBe(true);
  // A second close of a server already gone settles at once.
  await connection.close();
  expect(escaped).toEqual([]);
});
