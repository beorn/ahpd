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
  const opening = createOpening(ctx);
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
  const opening = createOpening(ctx);
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
    session = await agent.create({ uri, chatUri: 'ahp-chat:/original',
      ...(fact === undefined ? {} : { sessionConversation: fact }),
      clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, settings: {}, workingDirectory: folder,
      trusted: () => true, schema: () => ({ type: 'object', properties: {} }),
      emit: (_channel, action) => { actions.push(action as Bag); },
    });
    expect(existsSync(log)).toBe(false);
    expect(existsSync(`${prefix}.custody`)).toBe(false);
    expect(existsSync(`${prefix}.pid`)).toBe(false);
    expect(existsSync(`${prefix}.stat`)).toBe(false);
    session.sendMessage('t1', 'hello');
    await until(() => failure(actions) !== undefined);
    expect(failure(actions)).toContain('no matching configured ACP process authority');
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
      if (method === 'bookkeeping') expect(session?.agentId()).toMatch(/^acp-session-/u);
      if (method === 'load-bookkeeping') expect(session?.agentId()).toBe('recorded-backend-id');
      if (refused !== undefined) expect(String(refused)).toContain(`fixture refused ${method}`);
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

it('fails the first turn of a session whose command is missing, and nothing escapes', async () => {
  const { session, actions } = await start(MISSING);
  session.sendMessage('t1', 'hi');
  await until(() => failure(actions) !== undefined);

  expect(failure(actions)).toContain(MISSING);
  expect(failure(actions)).toContain('not found');
  // A second turn fails the same way rather than waiting on the first attempt.
  session.sendMessage('t2', 'hi again');
  await until(() => actions.filter((action) => action.type === 'chat/error').length > 1);
  expect(actions.filter((action) => action.type === 'chat/error')).toHaveLength(2);
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
 * A listing the server cannot make is the host's to ask again, so it rejects
 * rather than answering the watched sessions as the whole catalogue, as VS
 * Code's Codex agent answers a listing it cannot make.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8043-L8052
 */
it('rejects a listing whose command is missing, and logs it', async () => {
  watchSession({ provider: 'acp-missing-list', id: 'kept', cwd: '/tmp', additional: [], title: 'Kept' });
  const lines: string[] = [];
  const agent = acpAgent({ command: MISSING, provider: 'acp-missing-list', log: (line) => { lines.push(line); } });
  await expect(agent.list?.()).rejects.toThrow(`${MISSING} was not found`);
  expect(lines.some((line) => line.startsWith('acp-missing-list: session/list failed:'))).toBe(true);
  await pause(20);
  expect(escaped).toEqual([]);
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
