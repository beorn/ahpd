import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createShells } from '../src/host/shells.js';
import { createShellAuthentication, SHELL_AUTH_SOCKET, SHELL_AUTH_TOKEN } from '../src/host/shellauth.js';
import { createTerminals } from '../src/host/terminals.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { buildNonPtyShellTerminalUri } from '../src/vscode/nonptyshellterminaluri.js';
import type { ShellAuthentication } from '../src/host/shellauth.js';
import type { HostContext } from '../src/host/context.js';
import type { Bag } from '../src/types/common.js';
import type { ComputerPort, Spawn } from '../src/types/computers.js';
import type { Screen, SpawnPty, SpawnScreen, Terminal } from '../src/types/terminals.js';

/*
 * The helper's variables, in the processes this host starts.
 *
 * The shell manager is driven on the real terminal store and a pseudoterminal
 * that only says what a case tells it, so what is checked is the environment
 * the started process really received. The agent's own `env` is covered by the
 * `envFor` cases here and by each backend's suite.
 */

const DIR = tmpdir();
const SESSION = 'ahp-session:/shells';
const CHAT = 'ahp-chat:/shells-1';
/** The wrapper the host writes for this platform's tools. */
const WRAPPER = process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh';

/** The pseudoterminals a case started, and what each was given. */
interface FakePty {
  spawn: SpawnPty;
  started: { shell: string; args: string[] | string; env: Record<string, string | undefined>; cwd?: string }[];
}

const fakePty = (): FakePty => {
  const started: FakePty['started'] = [];
  const spawn: SpawnPty = (shell, args, options) => {
    started.push({ shell, args, env: options.env, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    return {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      kill: () => {},
    };
  };
  return { spawn, started };
};

/** A screen that says nothing and enters no alternate buffer. */
const quietScreen = (): SpawnScreen => () => ({
  write: async () => {},
  resize: () => {},
  isInAltBuffer: () => false,
  isBracketedPasteMode: () => false,
  whenAltBuffer: async () => {},
  dispose: () => {},
} satisfies Screen);

/** What a fake host keeps for a case to read back. */
interface Made {
  ctx: HostContext;
  auth: ShellAuthentication;
  pty: FakePty;
  config: Bag;
  folder: string;
  /** The host's session records, which name a machine. */
  sessions: Map<string, unknown>;
  /** The terminal store the host opens every shell through. */
  store: ReturnType<typeof shellTerminals>;
  /** A chat's shells, as a tool call is given them. */
  shellsOf(chat: string): ReturnType<ReturnType<typeof createShells>['of']>;
}

/**
 * The host this area reads, with the real terminal store and the real socket.
 *
 * `computers` and `sessions` are the machine's own, for a session told to run
 * in one: `machineOf` reads its id off the session's config.
 */
const host = async (over: { enables?: boolean; computer?: boolean } = {}): Promise<Made> => {
  const pty = fakePty();
  const store = shellTerminals({ pty: pty.spawn, screen: quietScreen() });
  const folder = mkdtempSync(join(tmpdir(), 'ahpd-shell-auth-env-'));
  const config: Bag = { shellAuthentication: over.enables ?? true };
  const terminals = new Map<string, Terminal>();
  const sessions = new Map<string, unknown>(over.computer === true
    ? [[SESSION, { chats: new Map(), defaultChat: CHAT, config: { computer: 'computer://box' } }]]
    : [[SESSION, { chats: new Map(), defaultChat: CHAT, config: {} }]]);
  const computers: ComputerPort | undefined = over.computer === true
    ? {
      how: async (id: string, options: { command: string }): Promise<Spawn> => ({
        command: 'docker',
        args: ['exec', '-it', id, options.command],
        env: { FROM: 'machine' },
        cwd: DIR,
      }),
    }
    : undefined;
  const note = (): void => {};
  const log = Object.assign(note, {
    trace: note, debug: note, info: note, warn: note, error: note,
  });
  const ctx = {
    rootConfig: config,
    options: {
      path: DIR,
      agents: [],
      terminals: store,
      ...(computers === undefined ? {} : { computers }),
    },
    terminals,
    sessions,
    byChat: new Map([[CHAT, { uri: SESSION }]]),
    subagents: new Map(),
    dispatch: () => {},
    log,
    closed: false,
    fire: () => {},
    dirOfFile: () => undefined,
    refreshWatched: async () => {},
    keepExited: () => {},
    nonPtyShellTerminalUri: (session: string, chat: string, key: string) => buildNonPtyShellTerminalUri(session, session, chat, key),
  } as unknown as HostContext;
  Object.assign(ctx, createTerminals(ctx));
  const auth = createShellAuthentication(ctx, {
    folder,
    parentOf: async () => ({ pid: 1, name: 'sudo' }),
  });
  ctx.shellAuth = auth;
  await auth.update();
  ctx.shells = createShells(ctx);
  opened.push({ auth, folder });
  return {
    ctx,
    auth,
    pty,
    config,
    folder,
    sessions,
    store,
    shellsOf: (chat) => ctx.shells.of(SESSION, chat),
  };
};

const opened: { auth: ShellAuthentication; folder: string }[] = [];

afterEach(async () => {
  for (const { auth, folder } of opened.splice(0)) {
    await auth.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

/** A chat's shells, or a case that could not get them. */
const shellsFor = (made: Made, chat = CHAT) => {
  const shells = made.shellsOf(chat);
  if (shells === undefined) throw new Error('no shells');
  return shells;
};

describe('the helper\'s variables in a session\'s shells', () => {
  it('gives an agent\'s tool shell the helper, the socket and its chat\'s token', async () => {
    const made = await host();
    const shells = shellsFor(made);
    const held = await shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    held.release();

    const env = made.pty.started.at(-1)?.env ?? {};
    expect(env.SUDO_ASKPASS).toBe(join(made.folder, WRAPPER));
    expect(env.SSH_ASKPASS).toBe(join(made.folder, WRAPPER));
    expect(env.SSH_ASKPASS_REQUIRE).toBe('force');
    expect(env.GIT_ASKPASS).toBe(join(made.folder, WRAPPER));
    if (process.platform === 'win32') expect(env[SHELL_AUTH_SOCKET]).toMatch(/^\\\\\.\\pipe\\ahpd-shell-auth-/);
    else expect(env[SHELL_AUTH_SOCKET]).toBe(join(made.folder, 'socket'));
    expect(env[SHELL_AUTH_TOKEN]).toMatch(/^[0-9a-f-]{36}$/);
    // The same chat's next shell is given the same token.
    const again = await shells.acquire({ chat: CHAT, toolCallId: 'call-2' });
    again.release();
    expect(made.pty.started.at(-1)?.env[SHELL_AUTH_TOKEN]).toBe(env[SHELL_AUTH_TOKEN]);
  });

  it('gives no helper to a shell on this host while the setting is off', async () => {
    const made = await host({ enables: false });
    const shells = shellsFor(made);
    await shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    const env = made.pty.started.at(-1)?.env ?? {};
    expect(env[SHELL_AUTH_SOCKET]).toBeUndefined();
    expect(env[SHELL_AUTH_TOKEN]).toBeUndefined();
    expect(env.SUDO_ASKPASS).toBeUndefined();

    // Turned off with a shell already running: the next new shell gets none.
    made.config.shellAuthentication = true;
    await made.auth.update();
    const other = 'ahp-chat:/shells-2';
    made.sessions.set(SESSION, { chats: new Map(), defaultChat: other, config: {} });
    const second = shellsFor(made, other);
    await second.acquire({ chat: other, toolCallId: 'call-3' });
    expect(made.pty.started.at(-1)?.env[SHELL_AUTH_SOCKET]).toBeTruthy();
    made.config.shellAuthentication = false;
    await made.auth.update();
    const third = shellsFor(made, 'ahp-chat:/shells-3');
    await third.acquire({ chat: 'ahp-chat:/shells-3', toolCallId: 'call-4' });
    expect(made.pty.started.at(-1)?.env[SHELL_AUTH_SOCKET]).toBeUndefined();
    expect(made.pty.started.at(-1)?.env.SUDO_ASKPASS).toBeUndefined();  });

  it('gives no helper to a shell a session runs in a machine, and keeps the machine\'s own variables', async () => {
    const made = await host({ computer: true });
    const shells = shellsFor(made);
    await shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    const env = made.pty.started.at(-1)?.env ?? {};
    expect(env.FROM).toBe('machine');
    expect(env[SHELL_AUTH_SOCKET]).toBeUndefined();
    expect(env[SHELL_AUTH_TOKEN]).toBeUndefined();
  });

  it('gives no helper to a terminal a person opens', async () => {
    const made = await host();
    made.store.create({
      uri: 'ahp-terminal:/person',
      cwd: DIR,
      claim: { kind: 'client', clientId: 'one' },
      emit: () => {},
    });
    const env = made.pty.started.at(-1)?.env ?? {};
    expect(env[SHELL_AUTH_SOCKET]).toBeUndefined();
    expect(env[SHELL_AUTH_TOKEN]).toBeUndefined();
  });

  it('keeps a helper the process\'s own environment already names', async () => {
    const made = await host();
    const had = { SSH_ASKPASS: process.env.SSH_ASKPASS, GIT_ASKPASS: process.env.GIT_ASKPASS };
    process.env.SSH_ASKPASS = '/home/example/my-askpass';
    process.env.GIT_ASKPASS = '/home/example/my-git-askpass';
    try {
      const env = made.auth.envFor(CHAT);
      expect(env.SSH_ASKPASS).toBeUndefined();
      expect(env.GIT_ASKPASS).toBeUndefined();
      // The host's own helper is still what sudo is pointed at.
      expect(env.SUDO_ASKPASS).toBe(join(made.folder, WRAPPER));
    }
    finally {
      if (had.SSH_ASKPASS === undefined) delete process.env.SSH_ASKPASS;
      else process.env.SSH_ASKPASS = had.SSH_ASKPASS;
      if (had.GIT_ASKPASS === undefined) delete process.env.GIT_ASKPASS;
      else process.env.GIT_ASKPASS = had.GIT_ASKPASS;
    }
  });
});
