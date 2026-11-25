import { execFile, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAsking } from '../src/host/asking.js';
import { createShellAuthentication, realCallerPaths } from '../src/host/shellauth.js';
import { createVscodeMethods } from '../src/host/vscodemethods.js';
import { SHELL_AUTH_SOCKET, SHELL_AUTH_TOKEN } from '../src/host/shellauth.js';
import type { ConnectionContext, HostContext } from '../src/host/context.js';
import type { ParentProcess, ShellAuthentication } from '../src/host/shellauth.js';
import type { Bag } from '../src/types/common.js';

/*
 * A command asking the person for a password.
 *
 * The helper here is the one the host writes, run as `sudo -A`, `ssh` and
 * `git` run it, against a host built from the areas this needs and no more:
 * the root config, the asking map, a chat state with a running tool call, and
 * a process table that says the helper's parent is whatever the test chose.
 */

const CHAT = 'ahp-chat:/one';
const SESSION = 'ahp-session:/one';
/** The wrapper the host writes for this platform's tools. */
const WRAPPER = process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh';

/** One action the host said, and the channel it said it on. */
interface Said {
  channel: string;
  action: Bag;
}

interface Made {
  ctx: HostContext;
  state: Bag;
  sent: Said[];
  config: Record<string, unknown>;
  asks: ReturnType<typeof createAsking>;
  logs: string[];
}

/** A host in the shape this area reads, with the dispatch the asking map and the prompts share. */
const made = (enabled = true): Made => {
  const state: Bag = {};
  const sent: Said[] = [];
  const logs: string[] = [];
  const config: Record<string, unknown> = { shellAuthentication: enabled };
  const asks = createAsking({ dispatch: (channel, action) => { sent.push({ channel, action }); } });
  const note = (line: string): void => { logs.push(line); };
  const log = Object.assign(note, {
    trace: note, debug: note, info: note, warn: note, error: note,
  });
  const ctx = {
    rootConfig: config,
    asks,
    byChat: new Map([[CHAT, { uri: SESSION }]]),
    subagents: new Map(),
    sessions: new Map([[SESSION, { config: {} }]]),
    stateOf: (channel: string) => (channel === CHAT ? state : undefined),
    dispatch: (channel: string, action: Record<string, unknown>) => { sent.push({ channel, action }); },
    log,
  } as unknown as HostContext;
  return { ctx, state, sent, config, asks, logs };
};

/** A turn in the chat running `command`. */
const running = (state: Bag, command = 'sudo apt-get update', id = 't1'): void => {
  state.activeTurn = {
    id,
    responseParts: [{
      kind: 'toolCall',
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'bash',
        displayName: 'Bash',
        status: 'running',
        toolInput: JSON.stringify({ command }),
      },
    }],
  };
};

const requests = (sent: Said[]): Bag[] =>
  sent.filter((one) => one.action.type === 'chat/inputRequested').map((one) => one.action.request as Bag);

const completions = (sent: Said[]): Bag[] =>
  sent.filter((one) => one.action.type === 'chat/inputCompleted').map((one) => one.action);

/** Wait for something the host says, which arrives a helper's process later. */
const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (ok()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the host said nothing in time');
};

/**
 * Run the wrapper the host names, as a program that honors the variable does.
 *
 * On Windows that wrapper is a batch file, which is not an executable image:
 * a tool runs it through `cmd.exe`, and so does this. `/s` makes cmd strip one
 * surrounding pair of quotes, so the line needs an outer pair, and what is
 * left is the wrapper and the prompt, each quoted as its own argument.
 */
const launch = (
  env: Record<string, string>,
  prompt: string,
  overrides: Record<string, string> = {},
): ChildProcess => {
  const wrapper = env.SUDO_ASKPASS ?? '';
  const options = { env: { ...process.env, ...env, ...overrides } };
  if (process.platform !== 'win32' || !/\.cmd$/i.test(wrapper)) return execFile(wrapper, [prompt], options);
  const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const line = `"${quoted(wrapper)} ${quoted(prompt)}"`;
  return execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', line], {
    ...options,
    windowsVerbatimArguments: true,
  });
};

/** Run the helper as the program would, and keep what it wrote to its output. */
const helper = (
  env: Record<string, string>,
  prompt: string,
  overrides: Record<string, string> = {},
): Promise<{ code: number; stdout: string }> => new Promise((resolve) => {
  const child = launch(env, prompt, overrides);
  let stdout = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.on('error', () => resolve({ code: 1, stdout: '' }));
  child.on('close', (code) => resolve({ code: typeof code === 'number' ? code : 1, stdout }));
});

/** End a launched wrapper and the helper it runs, which on Windows is its child. */
const endProcess = (child: ChildProcess): void => {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    return;
  }
  child.kill();
};

/**
 * Ask over a connection this process opens, claiming `pid` and the socket this
 * process holds. The host reads the claim as a helper's, as it would a helper's
 * own line, and the answer is read as the helper reads it, so a case can tell
 * an answer from a refusal. This is how a case says a pid that is not the
 * connection's.
 */
const askAs = (env: Record<string, string>, pid: number): Promise<{ code: number; stdout: string }> => new Promise((resolve) => {
  const socket = createConnection(env[SHELL_AUTH_SOCKET] ?? '');
  let heard = '';
  let done = false;
  const finish = (code: number, stdout: string): void => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({ code, stdout });
  };
  socket.setEncoding('utf8');
  socket.on('connect', () => {
    const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd;
    const target = typeof fd === 'number' ? readlinkSync(`/proc/self/fd/${fd}`) : '';
    const inode = target.startsWith('socket:[') ? Number(target.slice('socket:['.length, -1)) : 0;
    socket.write(JSON.stringify({
      token: env[SHELL_AUTH_TOKEN], prompt: 'Password:', pid, socket: inode,
    }) + '\n');
  });
  socket.on('data', (chunk: string) => {
    heard += chunk;
    const newline = heard.indexOf('\n');
    if (newline < 0) return;
    let answer: unknown;
    try { answer = (JSON.parse(heard.slice(0, newline)) as { answer?: unknown }).answer; }
    catch { answer = undefined; }
    if (typeof answer === 'string') finish(0, `${answer}\n`);
    else finish(1, '');
  });
  // The host ends a connection it refuses with nothing on it.
  socket.on('close', () => finish(1, ''));
  socket.on('error', () => finish(1, ''));
});

const open = async (
  options: { enabled?: boolean; parent?: string; exe?: string; callers?: ReadonlySet<string> } = {},
) => {
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-shell-auth-test-'));
  const host = made(options.enabled ?? true);
  const callers = options.callers ?? realCallerPaths();
  const resolved = options.exe ?? [...callers][0];
  const parent: ParentProcess = {
    pid: 1,
    name: options.parent ?? 'sudo',
    ...(resolved === undefined ? {} : { exe: resolved }),
  };
  const auth = createShellAuthentication(host.ctx, {
    folder,
    callers,
    parentOf: async () => parent,
  });
  host.ctx.shellAuth = auth;
  opened.push({ auth, folder });
  await auth.update();
  return {
    ...host,
    auth,
    folder,
    env: auth.envFor(CHAT),
    methods: createVscodeMethods(host.ctx, { connection: {} } as unknown as ConnectionContext),
  };
};

const opened: { auth: ShellAuthentication; folder: string }[] = [];

afterEach(async () => {
  for (const { auth, folder } of opened.splice(0)) {
    await auth.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('a command asks the person for a password', () => {
  it('turns the helper\'s prompt into the request and the answer into its output', async () => {
    const { state, sent, env, folder, methods, logs } = await open();
    running(state);
    expect(env.SUDO_ASKPASS).toBe(join(folder, WRAPPER));
    expect(env.SSH_ASKPASS).toBe(join(folder, WRAPPER));
    expect(env.SSH_ASKPASS_REQUIRE).toBe('force');
    expect(env.GIT_ASKPASS).toBe(join(folder, WRAPPER));
    if (process.platform === 'win32') expect(env[SHELL_AUTH_SOCKET]).toMatch(/^\\\\\.\\pipe\\ahpd-shell-auth-/);
    else expect(env[SHELL_AUTH_SOCKET]).toBe(join(folder, 'socket'));
    expect(env[SHELL_AUTH_TOKEN]).toMatch(/^[0-9a-f-]{36}$/);

    const pending = helper(env, 'Password:');
    await until(() => requests(sent).length === 1);
    const request = requests(sent)[0] as Bag;
    expect(String(request.id)).toMatch(/^host-ask:/);
    expect(request.purpose).toBe('shellAuthentication');
    expect(request._meta).toEqual({
      'vscode.shellAuthentication': {
        program: 'sudo',
        prompt: 'Password:',
        inputKind: 'secret',
        command: 'sudo apt-get update',
      },
    });
    expect((request.questions as Bag[])[0]).toMatchObject({
      id: 'shellAuthentication',
      kind: 'single-select',
      message: 'Password:',
      required: true,
      allowFreeformInput: false,
      options: [{ id: 'Cancel', label: 'Cancel' }],
    });

    expect(await methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: request.id, answer: 'hunter2',
    })).toEqual({ delivered: true });
    expect(await pending).toEqual({ code: 0, stdout: 'hunter2\n' });
    // The answer went down the helper's connection and nowhere else.
    expect(JSON.stringify(sent)).not.toContain('hunter2');
    expect(JSON.stringify(logs)).not.toContain('hunter2');
    expect(completions(sent)).toMatchObject([{ requestId: request.id, response: 'accept' }]);
  });

  it('says which kind of prompt it is from the program\'s words', async () => {
    const { state, sent, env, methods } = await open();
    running(state);
    const kinds: [string, string][] = [
      ['Username for \'https://example.com\':', 'text'],
      ['Are you sure you want to continue connecting (yes/no/[fingerprint])?', 'confirm'],
      ['Enter passphrase for key \'/home/example/.ssh/id_ed25519\':', 'secret'],
    ];
    for (const [prompt, kind] of kinds) {
      const seen = requests(sent).length;
      const pending = helper(env, prompt);
      await until(() => requests(sent).length > seen);
      const request = requests(sent).at(-1) as Bag;
      expect((request._meta as Bag)['vscode.shellAuthentication']).toMatchObject({ prompt, inputKind: kind });
      await methods['vscode/answerShellAuthentication']({ chat: CHAT, requestId: request.id, answer: 'yes' });
      await pending;
    }
  });

  it('cancels at once with no running turn, in autopilot, and with auto-reply', async () => {
    const { ctx, state, sent, env, config } = await open();
    // No turn.
    expect((await helper(env, 'Password:')).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);

    running(state);
    config.globalAutoApproveEnabled = true;
    expect((await helper(env, 'Password:')).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);

    config.globalAutoApproveEnabled = false;
    config.autoReplyEnabled = true;
    expect((await helper(env, 'Password:')).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);

    // The session's own autopilot, which the chat runs under.
    config.autoReplyEnabled = false;
    const held = ctx.sessions.get(SESSION) as { config: Bag };
    held.config.autoApprove = 'autoApprove';
    expect((await helper(env, 'Password:')).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);
  });

  it('refuses a token this host does not know', async () => {
    const { state, sent, env } = await open();
    running(state);
    expect((await helper(env, 'Password:', { [SHELL_AUTH_TOKEN]: 'not-a-token' })).code).not.toBe(0);
    expect((await helper(env, 'Password:', { [SHELL_AUTH_SOCKET]: '/nowhere' })).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);
  });

  it('refuses a helper whose parent is not sudo, ssh or git', async () => {
    const { state, sent, env } = await open({ parent: 'bash' });
    running(state);
    expect((await helper(env, 'Password:')).code).not.toBe(0);
    expect(requests(sent)).toEqual([]);
  });

  it.skipIf(process.platform !== 'linux')('refuses a pid that does not hold the helper\'s end of the connection', async () => {
    const { state, sent, env, methods } = await open();
    running(state);

    // This process holds the end it opened; its parent holds no such socket,
    // so the claim is refused with no answer and no request.
    expect(await askAs(env, process.ppid)).toEqual({ code: 1, stdout: '' });
    expect(requests(sent)).toEqual([]);

    const mine = askAs(env, process.pid);
    await until(() => requests(sent).length === 1);
    const request = requests(sent)[0] as Bag;
    expect(await methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: request.id, answer: 'hunter2',
    })).toEqual({ delivered: true });
    expect(await mine).toEqual({ code: 0, stdout: 'hunter2\n' });
  });

  it.skipIf(process.platform !== 'linux')('refuses a parent named git that is not the real git', async () => {
    const fakeFolder = mkdtempSync(join(tmpdir(), 'ahpd-fake-git-'));
    const fake = join(fakeFolder, 'git');
    writeFileSync(fake, '#!/bin/sh\n', { mode: 0o700 });
    try {
      const { state, sent, env } = await open({ parent: 'git', exe: realpathSync(fake) });
      running(state);
      expect((await helper(env, 'Password:')).code).not.toBe(0);
      expect(requests(sent)).toEqual([]);
    }
    finally {
      rmSync(fakeFolder, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'linux')('takes a parent that runs the real program', async () => {
    const callers = realCallerPaths();
    const real = [...callers].find((one) => basename(one) === 'git') ?? [...callers][0];
    expect(real).toBeDefined();
    if (real === undefined) return;
    const { state, sent, env, methods } = await open({ parent: 'git', exe: real, callers });
    running(state);
    const pending = helper(env, 'Password:');
    await until(() => requests(sent).length === 1);
    const request = requests(sent)[0] as Bag;
    expect(await methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: request.id, answer: 'hunter2',
    })).toEqual({ delivered: true });
    expect(await pending).toEqual({ code: 0, stdout: 'hunter2\n' });
  });

  it('opens nothing while the setting is off, and closes what it holds when it goes off', async () => {
    const off = await open({ enabled: false });
    expect(off.env).toEqual({});
    expect(off.config.shellAuthentication).toBe(false);

    const on = await open();
    running(on.state);
    const pending = helper(on.env, 'Password:');
    await until(() => requests(on.sent).length === 1);
    const request = requests(on.sent)[0] as Bag;
    on.config.shellAuthentication = false;
    await on.auth.update();
    expect((await pending).code).not.toBe(0);
    expect(completions(on.sent)).toMatchObject([{ requestId: request.id, response: 'cancel' }]);
    // And the prompt it held is gone, so its method answers delivered false.
    expect(await on.methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: request.id, answer: 'late',
    })).toEqual({ delivered: false });
  });

  it('cancels the prompt when its turn ends, when the client completes it, and when the helper goes', async () => {
    const { auth, asks, state, sent, env } = await open();
    running(state);

    // A turn that ends takes the request with it, and leaves the helper no answer.
    const ended = helper(env, 'Password:');
    await until(() => requests(sent).length === 1);
    asks.clearTurn(CHAT, 't1');
    expect((await ended).code).not.toBe(0);

    // A client completing the request on the chat does the same.
    const completed = helper(env, 'Password:');
    await until(() => requests(sent).length === 2);
    auth.completed(String(requests(sent).at(-1)?.id));
    expect((await completed).code).not.toBe(0);
    expect(completions(sent)).toMatchObject([{ response: 'cancel' }]);

    // A helper that goes on its own ends the request the chat still shows.
    const child = launch(env, 'Password:');
    await until(() => requests(sent).length === 3);
    endProcess(child);
    await until(() => completions(sent).length === 2);
    expect(completions(sent).at(-1)).toMatchObject({ response: 'cancel' });
  });

  it('answers an ended prompt delivered false, and refuses a chat that is not one', async () => {
    const { methods, auth } = await open();
    expect(await methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: 'host-ask:none', answer: 'x',
    })).toEqual({ delivered: false });
    await expect(methods['vscode/answerShellAuthentication']({
      chat: 'ahp-session:/one', requestId: 'host-ask:none',
    })).rejects.toThrow('chat must be an Agent Host chat URI');
    await expect(methods['vscode/answerShellAuthentication']({
      chat: 'nonsense', requestId: 'host-ask:none',
    })).rejects.toThrow('chat must be a valid URI string');
    await expect(methods['vscode/answerShellAuthentication']({
      chat: CHAT, requestId: ' ',
    })).rejects.toThrow('requestId must be a non-empty string');
    expect(auth.answer(CHAT, 'host-ask:none', 'x')).toBe(false);
  });
});
