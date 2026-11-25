import { execFile } from 'node:child_process';
import { accessSync, chmodSync, constants as fsConstants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { HOST_ASK } from './asking.js';
import { writeAskpass } from './askpass.js';
import { reason } from './common.js';
import type { AskpassFiles } from './askpass.js';
import type { HostContext } from './context.js';
import type { Bag } from '../types/common.js';
import type { AskedQuestion } from '../types/host.js';

/**
 * The passwords, passphrases and yes-or-no answers a command asks for.
 *
 * `sudo -A`, `ssh` and `git` run a helper named by `SUDO_ASKPASS`,
 * `SSH_ASKPASS` or `GIT_ASKPASS` when they need a person. The host writes that
 * helper, gives every process it starts the variables that name it and a token
 * for its chat, and listens on a local socket the helper reaches. A prompt
 * becomes `chat/inputRequested` on the chat, with `purpose` and `_meta` saying
 * what asked it; the answer comes back on `vscode/answerShellAuthentication`
 * and goes down the helper's connection, so it is never in a chat action.
 *
 * The socket and the helper's files live in a folder of the host's own, made
 * owner-only and removed with the setting. Nothing is listening while the
 * setting is off.
 */

/** The environment variable naming the host's socket, or its named pipe. */
export const SHELL_AUTH_SOCKET = 'AHPD_SHELL_AUTH_SOCKET';

/** The environment variable carrying the chat's token. */
export const SHELL_AUTH_TOKEN = 'AHPD_SHELL_AUTH_TOKEN';

/** What the window should mask, as `inputKind` names it. */
export type ShellAuthenticationInputKind = 'secret' | 'text' | 'confirm';

/** One helper waiting on a person. */
interface Prompt {
  /** The chat the prompt was asked on. */
  chat: string;
  /** The helper's connection. */
  socket: Socket;
}

/** What a chat's processes are told, and what ends a prompt. */
export interface ShellAuthentication {
  /**
   * The variables a process of `chat` is started with, or nothing while the
   * setting is off. A chat's first process is what mints its token.
   */
  envFor(chat: string): Record<string, string>;
  /** Forget a session's tokens and end the prompts its chats have in flight. */
  forgetSession(session: string): void;
  /** Cancel the prompt `id` because a client completed it; `false` when no helper waits on it. */
  completed(id: string): boolean;
  /** Hand the answer to the helper waiting on `id`; `false` when no helper waits on it. */
  answer(chat: string, id: string, answer: string | undefined): boolean;
  /** Follow the root setting: listen while it is on and stop while it is off. */
  update(): Promise<void>;
  /** End every prompt and remove the socket and the helper's files. */
  close(): Promise<void>;
}

/** What `createShellAuthentication` lets a test replace. */
export interface ShellAuthenticationOptions {
  /** The folder the socket and the helper's files go in; a temporary one when absent. */
  folder?: string;
  /** What spawned the helper whose process is `pid`; the process table when absent. */
  parentOf?: (pid: number) => Promise<ParentProcess | undefined>;
  /** The resolved paths of the real sudo, ssh and git; the ones on PATH when absent. */
  callers?: ReadonlySet<string>;
}

/** A process, the name it runs under, and on Linux the executable it runs. */
export interface ParentProcess {
  pid: number;
  name: string;
  /** The resolved program, read from `/proc/<pid>/exe` on Linux. */
  exe?: string;
}

/** The programs whose prompts this host answers. */
const CALLERS = new Set(['sudo', 'ssh', 'git']);

/** Where the callers are installed when PATH does not name them. */
const SYSTEM_FOLDERS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/usr/local/sbin'];

/** The one question a shell authentication request carries. */
const QUESTION = 'shellAuthentication';

const execFileAsync = promisify(execFile);

/**
 * The real programs this host answers prompts from, as resolved paths.
 *
 * The callers are looked up on PATH and in the usual system folders, and each
 * is resolved through its symlinks, so a copy under one of their names is not
 * one of them. The host reads this once, when it starts.
 */
export const realCallerPaths = (path: string | undefined = process.env.PATH): ReadonlySet<string> => {
  const folders = [...(path ?? '').split(delimiter).filter((one) => one !== ''), ...SYSTEM_FOLDERS];
  const found = new Set<string>();
  for (const name of CALLERS) {
    for (const folder of folders) {
      const at = join(folder, name);
      try {
        accessSync(at, fsConstants.X_OK);
        found.add(realpathSync(at));
      }
      catch { /* the caller is not in this folder */ }
    }
  }
  return found;
};

/** The parent of `pid` on Linux, read from `/proc`. */
const parentOnLinux = async (pid: number): Promise<ParentProcess | undefined> => {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  if (close < 0) return undefined;
  const fields = stat.slice(close + 2).split(' ');
  const ppid = Number(fields[1]);
  if (!Number.isSafeInteger(ppid) || ppid <= 0) return undefined;
  const name = (await readFile(`/proc/${ppid}/comm`, 'utf8')).trim();
  if (name === '') return undefined;
  const exe = await readlink(`/proc/${ppid}/exe`).catch(() => undefined);
  return { pid: ppid, name, ...(exe === undefined ? {} : { exe }) };
};

/** A process's parent and that parent's name, as `ps` tells them on macOS and the BSDs. */
const parentOnPs = async (pid: number): Promise<ParentProcess | undefined> => {
  const { stdout: parent } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)]);
  const ppid = Number(parent.trim());
  if (!Number.isSafeInteger(ppid) || ppid <= 0) return undefined;
  const { stdout: named } = await execFileAsync('ps', ['-o', 'comm=', '-p', String(ppid)]);
  const name = named.trim();
  return name === '' ? undefined : { pid: ppid, name };
};

/** A process's parent and that parent's name, from Windows' process table. */
const parentOnWindows = async (pid: number): Promise<ParentProcess | undefined> => {
  const shell = ['-NoProfile', '-NonInteractive', '-Command'];
  const { stdout: parent } = await execFileAsync('powershell.exe', [
    ...shell, `(Get-CimInstance Win32_Process -Filter "ProcessId = ${String(pid)}").ParentProcessId`,
  ]);
  const ppid = Number(parent.trim());
  if (!Number.isSafeInteger(ppid) || ppid <= 0) return undefined;
  const { stdout: named } = await execFileAsync('powershell.exe', [
    ...shell, `(Get-Process -Id ${String(ppid)}).ProcessName`,
  ]);
  const name = named.trim();
  return name === '' ? undefined : { pid: ppid, name };
};

/** What spawned a process, read from the process table of the platform the host runs on. */
export const parentOfProcess: (pid: number) => Promise<ParentProcess | undefined> =
  process.platform === 'linux' ? parentOnLinux : process.platform === 'win32' ? parentOnWindows : parentOnPs;

/** The socket inodes `pid` holds, from the links in `/proc/<pid>/fd`; nothing when the folder cannot be read. */
const socketInodesOf = async (pid: number): Promise<Set<number> | undefined> => {
  let names: string[];
  try { names = await readdir(`/proc/${pid}/fd`); }
  catch { return undefined; }
  const inodes = new Set<number>();
  for (const name of names) {
    const target = await readlink(`/proc/${pid}/fd/${name}`).catch(() => undefined);
    if (target === undefined || !target.startsWith('socket:[') || !target.endsWith(']')) continue;
    const inode = Number(target.slice('socket:['.length, -1));
    if (Number.isSafeInteger(inode) && inode > 0) inodes.add(inode);
  }
  return inodes;
};

/** The inodes `/proc/net/unix` lists for connected stream sockets. */
const connectedUnixInodes = async (): Promise<Set<number>> => {
  const text = await readFile('/proc/net/unix', 'utf8');
  const inodes = new Set<number>();
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 7 || fields[4] !== '0001' || fields[5] !== '03') continue;
    const inode = Number(fields[6]);
    if (Number.isSafeInteger(inode) && inode > 0) inodes.add(inode);
  }
  return inodes;
};

/** The program a parent's name says it is, as a path or a Windows `.exe` spells it. */
const programOf = (name: string): string => basename(name).replace(/\.exe$/i, '').toLowerCase();

/**
 * What `inputKind` says about a prompt.
 *
 * The words are the programs' own: sudo and ssh ask for a password or a
 * passphrase, and ssh asks yes or no before it trusts a host. Anything else -
 * git's user name among them - is text the window shows unmasked.
 */
const inputKindOf = (prompt: string): ShellAuthenticationInputKind => {
  if (/\(\s*yes\s*\/\s*no\b|\[\s*y\s*\/\s*n\s*\]|\byes\s*\/\s*no\b/i.test(prompt)) return 'confirm';
  if (/pass\s*(?:word|phrase|code)|\bsecret\b|\btoken\b|api[ -]?key/i.test(prompt)) return 'secret';
  return 'text';
};

/** One question with a single choice, so a client that does not know the purpose cannot send free text as an answer. */
const questionOf = (prompt: string): AskedQuestion[] => [{
  id: QUESTION,
  question: prompt === '' ? 'A command asks for authentication.' : prompt,
  options: [{ label: 'Cancel' }],
  allowOther: false,
}];

/** A parsed tool input, when it is JSON. */
const asJson = (text: string): unknown => {
  try { return JSON.parse(text) as unknown; }
  catch { return text; }
};

/**
 * The command of the tool call the chat runs now, when it names one.
 *
 * The last running call is the one that reached the shell: an agent's tool
 * call carries its input as JSON, and a `!` command carries the text itself.
 */
const runningCommand = (ctx: HostContext, chat: string): string | undefined => {
  const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
  const parts = Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const call = parts[i]?.toolCall as Bag | undefined;
    if (call === undefined || call.status !== 'running') continue;
    const input = call.toolInput;
    const parsed = typeof input === 'string' ? asJson(input) : input;
    const command = typeof parsed === 'string'
      ? parsed
      : typeof (parsed as Bag | undefined)?.command === 'string' ? (parsed as Bag).command as string : undefined;
    if (command !== undefined && command !== '') return command;
  }
  return undefined;
};

/**
 * Whether a person is not there to answer: autopilot or auto-reply.
 *
 * Autopilot approves its own tool calls and answers its own questions, so a
 * prompt would wait for nobody; the same setting VS Code's host reads before
 * it asks one.
 */
const unattended = (ctx: HostContext, chat: string): boolean => {
  if (ctx.rootConfig.autoReplyEnabled === true || ctx.rootConfig.globalAutoApproveEnabled === true) return true;
  const session = ctx.byChat.get(chat)?.uri;
  return session !== undefined && ctx.rootConfig.autoApprovePolicyRestricted !== true
    && ctx.sessions.get(session)?.config.autoApprove === 'autoApprove';
};

export function createShellAuthentication(
  ctx: HostContext,
  options: ShellAuthenticationOptions = {},
): ShellAuthentication {
  const parentOf = options.parentOf ?? parentOfProcess;
  const callers = options.callers ?? (process.platform === 'linux' ? realCallerPaths() : new Set<string>());
  /** Each chat's token, dropped when its processes are gone. */
  const tokens = new Map<string, string>();
  /** Each prompt in flight, by the request id the chat carries. */
  const prompts = new Map<string, Prompt>();
  /** Every connection a helper opened, a prompt's own among them. */
  const connections = new Set<Socket>();
  let server: Server | undefined;
  let folder: string | undefined;
  let files: AskpassFiles | undefined;
  let socketPath: string | undefined;
  /** The updates in the order they were asked for, so on and off do not cross. */
  let changing: Promise<void> = Promise.resolve();
  let closed = false;
  let warnedUnreadable = false;

  const enabled = (): boolean => !closed && ctx.rootConfig.shellAuthentication === true;

  const mint = (chat: string): string => {
    const token = crypto.randomUUID();
    tokens.set(chat, token);
    return token;
  };

  /** The chat a token was minted for, or nothing for one this host does not know. */
  const chatOfToken = (token: string): string | undefined => {
    for (const [chat, held] of tokens) {
      if (held === token) return chat;
    }
    return undefined;
  };

  /** The turn the chat runs, which a prompt needs to be put on. */
  const turnOf = (chat: string): string | undefined => {
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    return typeof turn?.id === 'string' ? turn.id : undefined;
  };

  /**
   * Whether `parent` is one of the programs this host answers.
   *
   * On Linux the parent's resolved executable must be one of the real callers
   * read at start, so a program that copied the name `git` is not git. The
   * kernel does not let a user read the executable of a setuid process, which
   * is what sudo is while it waits: there the name is all that is checked,
   * which is still a program the user could not have named without root. The
   * other platforms have no such link to follow and check the name alone.
   */
  const isCaller = async (parent: ParentProcess): Promise<boolean> => {
    if (!CALLERS.has(programOf(parent.name))) return false;
    if (process.platform !== 'linux') return true;
    if (parent.exe === undefined) {
      if (!warnedUnreadable) {
        warnedUnreadable = true;
        ctx.log.warn('shell authentication: a caller\'s executable could not be read, so its name alone was checked');
      }
      return true;
    }
    try { return callers.has(await realpath(parent.exe)); }
    catch { return false; }
  };

  /**
   * Whether `pid` holds the helper's end of the connection it sent its line on.
   *
   * The two ends of a unix socket are different sockets with different inodes,
   * and the accepted end is this host's. So the inode to find in the claimed
   * pid is the helper's own, which the helper reads from its `/proc/self/fd`
   * and sends with the prompt; `/proc/net/unix` must list it as a connected
   * stream socket.
   */
  const holdsConnection = async (pid: number, inode: number): Promise<boolean> => {
    if (process.platform !== 'linux') return true;
    if (!Number.isSafeInteger(inode) || inode <= 0) return false;
    const held = await socketInodesOf(pid).catch(() => undefined);
    if (held === undefined || !held.has(inode)) return false;
    const connected = await connectedUnixInodes().catch(() => undefined);
    return connected !== undefined && connected.has(inode);
  };

  /**
   * End the prompt `id` and take it off the chat.
   *
   * `answer` is the person's answer, which only the helper gets; with none the
   * helper is left with no answer and exits, as a cancelled prompt does. The
   * request is settled as cancelled in every case: it is the host's own, and
   * no backend has a request of that id to answer.
   */
  const endPrompt = (id: string, response: 'accept' | 'cancel', answer?: string): boolean => {
    const held = prompts.get(id);
    if (held === undefined) return false;
    prompts.delete(id);
    if (answer === undefined) held.socket.end();
    else held.socket.end(`${JSON.stringify({ answer })}\n`);
    ctx.asks.settle(id, 'cancel', {});
    ctx.dispatch(held.chat, { type: 'chat/inputCompleted', requestId: id, response });
    return true;
  };

  /** Start listening, in a folder of the host's own. */
  const open = async (): Promise<void> => {
    if (server !== undefined) return;
    const at = options.folder ?? mkdtempSync(join(tmpdir(), 'ahpd-shell-auth-'));
    chmodSync(at, 0o700);
    const written = writeAskpass(at);
    const path = process.platform === 'win32'
      ? `\\\\.\\pipe\\ahpd-shell-auth-${crypto.randomUUID()}`
      : join(at, 'socket');
    const made = createServer((socket) => {
      connections.add(socket);
      socket.setEncoding('utf8');
      socket.on('close', () => { connections.delete(socket); });
      socket.on('error', () => { socket.destroy(); });
      let heard = '';
      const onData = (chunk: string): void => {
        heard += chunk;
        const newline = heard.indexOf('\n');
        if (newline < 0) return;
        socket.off('data', onData);
        void begin(socket, heard.slice(0, newline));
      };
      socket.on('data', onData);
    });
    server = made;
    folder = at;
    files = written;
    socketPath = path;
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error): void => {
          made.off('listening', listening);
          reject(error);
        };
        const listening = (): void => {
          made.off('error', failed);
          resolve();
        };
        made.once('error', failed);
        made.once('listening', listening);
        made.listen(path);
      });
    }
    catch (error) {
      server = undefined;
      folder = undefined;
      files = undefined;
      socketPath = undefined;
      made.close();
      try { rmSync(at, { recursive: true, force: true }); } catch { /* it was never made */ }
      throw error;
    }
    // The folder is owner-only, and the socket's own mode is made so too
    // rather than left to the umask.
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    // A server does not keep a process alive on its own: the host does, and a
    // test that forgets to close it should still end.
    made.unref();
  };

  /** Stop listening and remove the socket and the helper's files. */
  const stop = async (): Promise<void> => {
    for (const id of [...prompts.keys()]) endPrompt(id, 'cancel');
    for (const socket of connections) socket.destroy();
    connections.clear();
    const made = server;
    const at = folder;
    server = undefined;
    folder = undefined;
    files = undefined;
    socketPath = undefined;
    if (made !== undefined) await new Promise<void>((resolve) => { made.close(() => resolve()); });
    if (at !== undefined) {
      try { rmSync(at, { recursive: true, force: true }); }
      catch (error) { ctx.log.warn(`shell authentication: could not remove ${at}: ${reason(error)}`); }
    }
  };

  /**
   * Read one helper's first line and put its prompt on the chat.
   *
   * Everything a helper can get wrong is a refusal with the connection
   * dropped: a line that does not parse, a token the host never minted or has
   * dropped, a `pid` that is not one, a pid that does not hold the helper's
   * end of the connection, a parent that is not `sudo`, `ssh` or `git`, a chat
   * with no turn running, and a person who has autopilot on.
   */
  const begin = async (socket: Socket, line: string): Promise<void> => {
    let said: Bag;
    try { said = JSON.parse(line) as Bag; }
    catch { socket.destroy(); return; }
    const token = typeof said.token === 'string' ? said.token : '';
    const prompt = typeof said.prompt === 'string' ? said.prompt : '';
    const pid = typeof said.pid === 'number' && Number.isSafeInteger(said.pid) && said.pid > 0 ? said.pid : 0;
    const inode = typeof said.socket === 'number' && Number.isSafeInteger(said.socket) && said.socket > 0 ? said.socket : 0;
    if (token === '' || pid === 0) { socket.destroy(); return; }
    const chat = chatOfToken(token);
    if (chat === undefined) { socket.destroy(); return; }
    const parent = await parentOf(pid).catch(() => undefined);
    if (parent === undefined || !(await isCaller(parent))) { socket.destroy(); return; }
    if (!(await holdsConnection(pid, inode))) { socket.destroy(); return; }
    if (closed || socket.destroyed) { socket.destroy(); return; }
    // What the chat held while the parent was read, which is what the prompt
    // is about: a turn that ended or a token that moved is a prompt nobody
    // waits on now.
    if (tokens.get(chat) !== token) { socket.destroy(); return; }
    const turn = turnOf(chat);
    if (turn === undefined || unattended(ctx, chat)) { socket.destroy(); return; }
    const command = runningCommand(ctx, chat);
    const id = `${HOST_ASK}${crypto.randomUUID()}`;
    prompts.set(id, { chat, socket });
    socket.once('close', () => {
      const held = prompts.get(id);
      if (held === undefined) return;
      prompts.delete(id);
      ctx.asks.settle(id, 'cancel', {});
      ctx.dispatch(chat, { type: 'chat/inputCompleted', requestId: id, response: 'cancel' });
    });
    const asked = ctx.asks.ask(chat, turn, questionOf(prompt), {
      id,
      purpose: 'shellAuthentication',
      meta: {
        'vscode.shellAuthentication': {
          program: programOf(parent.name),
          prompt,
          inputKind: inputKindOf(prompt),
          ...(command === undefined ? {} : { command }),
        },
      },
    });
    asked.then(() => {
      // The turn ended, or the host ended the request with no answer: the
      // helper goes without one.
      const held = prompts.get(id);
      if (held === undefined) return;
      prompts.delete(id);
      held.socket.end();
    }, (error: unknown) => {
      const held = prompts.get(id);
      if (held !== undefined) {
        prompts.delete(id);
        held.socket.destroy();
      }
      ctx.log.warn(`shell authentication: could not ask: ${reason(error)}`);
    });
  };

  const envFor = (chat: string): Record<string, string> => {
    if (!enabled() || files === undefined || socketPath === undefined) return {};
    const token = tokens.get(chat) ?? mint(chat);
    const wrapper = files.wrapper;
    return {
      SUDO_ASKPASS: wrapper,
      // A person's own helper wins: theirs is the one they configured, and
      // this host cannot know what it asks.
      ...(process.env.SSH_ASKPASS === undefined ? { SSH_ASKPASS: wrapper } : {}),
      SSH_ASKPASS_REQUIRE: 'force',
      ...(process.env.GIT_ASKPASS === undefined ? { GIT_ASKPASS: wrapper } : {}),
      [SHELL_AUTH_SOCKET]: socketPath,
      [SHELL_AUTH_TOKEN]: token,
    };
  };

  const forgetSession = (session: string): void => {
    for (const chat of [...tokens.keys()]) {
      const owner = ctx.byChat.get(chat)?.uri ?? ctx.subagents.get(chat)?.session;
      if (owner !== session) continue;
      tokens.delete(chat);
      for (const [id, held] of [...prompts]) {
        if (held.chat === chat) endPrompt(id, 'cancel');
      }
    }
  };

  const completed = (id: string): boolean => {
    if (!prompts.has(id)) return false;
    return endPrompt(id, 'cancel');
  };

  const answer = (chat: string, id: string, given: string | undefined): boolean => {
    const held = prompts.get(id);
    if (held === undefined || held.chat !== chat) return false;
    return endPrompt(id, given === undefined ? 'cancel' : 'accept', given);
  };

  const update = (): Promise<void> => {
    changing = changing
      .then(() => (enabled() ? open() : stop()))
      .catch((error: unknown) => { ctx.log.warn(`shell authentication: ${reason(error)}`); });
    return changing;
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    tokens.clear();
    await changing.catch(() => undefined);
    await stop();
  };

  return { envFor, forgetSession, completed, answer, update, close };
}
