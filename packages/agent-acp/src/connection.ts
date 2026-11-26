/**
 * The ACP connection: one command spawned, and one client over its stdio.
 *
 * `@agentclientprotocol/sdk` owns the JSON-RPC framing, the request ids and
 * the notification routing, so all this file does is spawn the program, hand
 * the SDK its two byte streams, and name the calls a session makes on a
 * connection. The client app is the server's way in: every `session/update` it
 * sends arrives at the handler registered for it, and every permission it asks
 * for arrives at the one for that.
 */

import { execFile, spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Transform, Writable } from 'node:stream';
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  AuthenticateRequest,
  AuthenticateResponse,
  ClientCapabilities,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import { bag, isRecord, levelIn, sdkVersion, str } from '@ahpd/sdk';
import type { Account } from '@ahpd/sdk';
import type { AcpConnection, AcpConnectionOptions } from './types.js';

/**
 * What this bridge answers a permission request with when nobody can be asked.
 *
 * `cancelled` is the protocol's refusal, and refusing is the honest answer: a
 * client that allowed a tool silently would be a client deciding policy.
 */
const REFUSED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/**
 * What this bridge reports in the handshake; it names the AHP package rather
 * than a harness.
 *
 * The version is read from the manifest rather than written down here, because
 * a `clientInfo` that names a build this process is not is the one number in
 * the handshake nobody can act on.
 */
const CLIENT_INFO = { name: 'ahpd', version: sdkVersion() };

/**
 * How long a call that failed because the stream closed waits to hear why,
 * unless the record's `exitGraceMs` says otherwise.
 *
 * The child's stdout can end a moment before its `exit` arrives, and the exit
 * code is the sentence a person needs; a server that closed its stdout and
 * kept running is never heard, so the wait is bounded.
 */
const EXIT_GRACE_MS = 1000;

/**
 * How much of the child's stderr is kept, unless the record's `stderrBytes`
 * says otherwise.
 *
 * Enough for the stack trace a server prints before it dies, and bounded so a
 * server that talks all day costs a fixed amount per session.
 */
const STDERR_BYTES = 8 * 1024;

/**
 * How long a server has to act on the SIGTERM before it is killed outright,
 * unless the record's `killGraceMs` says otherwise.
 *
 * A server that flushes what it wrote and unwinds its own work needs a moment;
 * one that took none of the SIGTERM must not hold the daemon's close open for
 * ever, which is what the SIGKILL is for.
 */
export const KILL_GRACE_MS = 5000;

/**
 * How long a spawned server may say nothing while a call is owed an answer,
 * unless the record's `startAnswerMs` says otherwise.
 *
 * A server that boots and never greets leaves a turn taken and unable to
 * begin: nothing in the protocol ends such a turn, and every reader is told
 * one runs that no process will finish (#38705). Generous, because a cold
 * machine starts a server slowly and this is a bound on silence rather than on
 * work: a session read back from a long conversation streams its replay the
 * whole way, and every message the server sends restarts the clock.
 */
const START_ANSWER_MS = 60_000;

/**
 * How many times the opening bound a prompt is given once it has said
 * anything (#38786, @cto 8c171c70): 600 s at the default. A model reasoning
 * quietly mid-turn for over a minute is normal and its work is real; one that
 * has said nothing for ten is not coming back.
 */
const AFTER_OUTPUT_FACTOR = 10;

/**
 * How long an open tool call may stay quiet before the turn is ended by name (#38695, @cto e1c1b0f1).
 *
 * The pause below is deliberate: a server building its own thing is quiet and working, which VS Code's host counts as
 * expected silence. But a pause is not a licence to wait for ever — a call the server never finishes held @dev/19's turn
 * open for 31.7 minutes with a wake queued behind it, and the turn bound could not see it because an open call disarmed
 * that clock entirely. So each call carries its own clock, and this is the one it falls back to when it declares none.
 */
export const TOOL_CALL_SILENCE_MS = 900_000;

/**
 * Windows, which has no process group to signal and no SIGTERM to send: a
 * negative pid there throws, and the server and what it started were never
 * stopped. Its tree is ended with `taskkill` instead.
 */
const windows = process.platform === 'win32';
const children = new WeakMap<AcpConnection, ChildProcess>();

/** Internal opening-owner access; not part of the package's connection API. */
export const childProcessOf = (connection: AcpConnection): ChildProcess | undefined => children.get(connection);

/**
 * End what a server left running on Windows, once it has exited.
 *
 * A server that exits when its stdin closes leaves what it started running:
 * there is no group, and `taskkill /T` follows a living parent. Windows keeps a
 * process's parent id after the parent has gone, so the server's descendants
 * are found by it afterwards, kept to those started since the server was, so a
 * pid the system has since handed to another program is never one of them.
 * One read of the process list, and only after the server is gone.
 */
const endLeftovers = (root: number, since: number): void => {
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }'],
    { windowsHide: true, timeout: 10_000 },
    (error, out) => {
      // A list that could not be read leaves nothing to end, as before.
      if (error !== null) return;
      const all: { pid: number; parent: number; started: number }[] = [];
      for (const line of out.split(/\r?\n/)) {
        const [pid, parent, started] = line.trim().split(' ').map(Number);
        if (pid !== undefined && parent !== undefined && started !== undefined && !Number.isNaN(started)) {
          all.push({ pid, parent, started });
        }
      }
      const left: number[] = [];
      const next = [root];
      while (next.length > 0) {
        const parent = next.pop() as number;
        for (const one of all) {
          if (one.parent === parent && one.started >= since && one.pid !== root && !left.includes(one.pid)) {
            left.push(one.pid);
            next.push(one.pid);
          }
        }
      }
      for (const pid of left) {
        execFile('taskkill', ['/pid', String(pid), '/F'], { windowsHide: true }, () => {});
      }
    },
  );
};

/**
 * Where a server says it reports its sign-in at all.
 *
 * ACP reserves `_meta` for extensions of its own, and this key is
 * `@agentclientprotocol/codex-acp`'s: the empty object under it is a presence
 * flag rather than a shape, so all it says is that the server reports its
 * sign-in at all.
 */
const AUTH_STATUS = 'authStatus';

/** The notification a server that advertises `authStatus` reports its sign-in with. */
const AUTH_STATUS_UPDATE = '_auth/status_update';

/** The sentence for a server that could not be started at all. */
const unstarted = (command: string, cwd: string | undefined, error: NodeJS.ErrnoException): Error => {
  if (error.code === 'ENOENT' && cwd !== undefined && !existsSync(cwd)) {
    return new Error(`${command} could not be started in ${cwd}, which does not exist`);
  }
  if (error.code === 'ENOENT') {
    return new Error(`${command} was not found; install it, or put its directory on the PATH the daemon runs with`);
  }
  return new Error(`${command} could not be started: ${error.message}`);
};

/**
 * What a server's `authStatus` says about the account, as the host publishes it.
 *
 * The kinds and the fields they carry are `@agentclientprotocol/codex-acp`'s:
 * an `account` names the email and the plan of the sign-in it is, and the other
 * three are sign-ins that are not an account of the operator's - a key, a
 * gateway, and a provider's own identity, which is what Bedrock and an agent's
 * own name are. None of those is a sign-out, so each is `unavailable`, and
 * none of them names an email; nor does a kind this bridge does not know, as
 * VS Code's Codex reads any account that is not a ChatGPT sign-in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAccountState.ts#L22-L31
 */
const accountOf = (status: unknown, at: number): Account | undefined => {
  if (!isRecord(status)) return undefined;
  const kind = str(status.kind);
  if (kind === 'none') return { status: 'signedOut', observedAt: at };
  if (kind !== 'account') return { status: 'unavailable', observedAt: at };
  // The nested object is left out entirely by a server that names neither, so
  // an account with no email is a sign-in this host can only say it has.
  const held = isRecord(status.account) ? status.account : {};
  const email = str(held.email);
  const plan = str(held.plan);
  return {
    status: 'signedIn',
    ...(email === undefined ? {} : { email }),
    ...(plan === undefined ? {} : { planType: plan }),
    observedAt: at,
  };
};

/** The sentence for a server that exited, by its code or the signal that ended it. */
const exited = (command: string, code: number | null, signal: NodeJS.Signals | null): Error =>
  new Error(code !== null ? `${command} exited with code ${code}` : `${command} exited on ${signal ?? 'an unknown signal'}`);

/**
 * Spawn one ACP server and speak the protocol to it.
 *
 * The environment is the daemon's with the package's own over the top, the way
 * a subprocess is given its parent's: a server finds its own `PATH` and its
 * own credentials unless something named one, which is the whole reason a
 * token does not have to be repeated in a configuration.
 */
export function connectAcp(options: AcpConnectionOptions): AcpConnection {
  const exitGraceMs = options.exitGraceMs ?? EXIT_GRACE_MS;
  const stderrBytes = options.stderrBytes ?? STDERR_BYTES;
  const startAnswerMs = options.startAnswerMs ?? START_ANSWER_MS;
  const toolCallSilenceMs = options.toolCallSilenceMs ?? TOOL_CALL_SILENCE_MS;
  // A second early, as a process's own start time is read back to the
  // millisecond and the two clocks need not agree on the last one.
  const spawnedAt = Date.now() - 1000;
  // The first three descriptors are always pipes, even with inherited extras.
  const child = spawn(options.command, options.args ?? [], {
    stdio: ['pipe', 'pipe', 'pipe', ...(options.extraStdio ?? [])] as const,
    env: { ...process.env, ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    /*
     * A group of its own, led by the server.
     *
     * Detached is what makes the close reach what the server started rather
     * than the one process: everything it spawns inherits this group, and a
     * signal to the group reaches all of it. It also keeps a signal meant for
     * this server off the daemon's own group. On Windows `detached` is a
     * console of its own instead, so it is left off, as a terminal leaves it.
     */
    ...(windows ? {} : { detached: true }),
    // A daemon on Windows has no console, and a console program it starts
    // opens a window of its own without this.
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  options.spawned?.(child);
  /*
   * Drained rather than inherited: a server that chatters on stderr must not
   * block on a full pipe, and it must not write into the daemon's own output.
   * Each line goes to the log as it arrives, as VS Code's agents log a
   * runtime's stderr, and the last of it is kept, because a server that dies
   * says why on stderr and the exit code alone is rarely the sentence a person
   * on a client needs: a failure carries it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2716
   */
  let partial = '';
  /**
   * One line of the server's stderr, in this host's log at the level the line
   * says it is, without the time the server put on it, and at info when it
   * says none.
   */
  const said = (line: string): void => {
    const read = levelIn(line);
    options.log?.(`${options.command} stderr: ${read?.text ?? line}`, read?.level ?? 'info');
  };
  let stderr = Buffer.alloc(0);
  /** Whether the ring has dropped bytes, and so may hold half a line. */
  let stderrCut = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const held = Buffer.concat([stderr, Buffer.from(chunk, 'utf8')]);
    stderrCut ||= held.length > stderrBytes;
    stderr = held.length > stderrBytes ? held.subarray(held.length - stderrBytes) : held;
    const lines = `${partial}${chunk}`.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') said(line);
  });
  /** Settles when the server's stderr has been read to its end. */
  let readStderr: () => void = () => {};
  const drained = new Promise<void>((resolve) => { readStderr = resolve; });
  child.stderr.on('end', () => {
    if (partial.trim() !== '') said(partial);
    partial = '';
    readStderr();
  });

  /** Why the server is gone, once it is; undefined while it runs. */
  let death: Error | undefined;
  /** Whether the server was told to go. */
  let closing = false;
  let heardDeath: (why: Error) => void = () => {};
  const ended = new Promise<Error>((resolve) => { heardDeath = resolve; });
  const die = (why: Error): void => {
    if (death !== undefined) return;
    death = why;
    heardDeath(why);
  };
  /*
   * An `error` with no pid is a program that never started. One after a start
   * is a failed kill or write, which the exit that follows reports; it is
   * listened for either way, because an unheard `error` ends the daemon.
   */
  child.on('error', (error: NodeJS.ErrnoException) => {
    if (child.pid === undefined) die(unstarted(options.command, options.cwd, error));
  });
  child.on('exit', (code, signal) => { die(exited(options.command, code, signal)); });

  /*
   * The bound on a server that stops talking (#38705).
   *
   * A bound on silence, not on time: a session read back from a long
   * conversation legitimately replays for minutes, but it streams
   * `session/update` the whole way, and every chunk the server writes is proof
   * it is working. So each chunk restarts the clock, and only a server that has
   * gone quiet while a call is owed an answer fails - in the words a person
   * needs, rather than as a turn every reader thinks is running.
   */
  const owed = new Set<{ step: string; tail: string; afterOutput: number | undefined; spoke: boolean; fail: (why: Error) => void; timer: NodeJS.Timeout | undefined }>();
  /*
   * #38786: the calls the server is waiting on this client to answer - a
   * person deciding a permission, a terminal it was told to wait for. While one
   * is open the silence is this client's, not the server's, so no clock runs.
   */
  let ours = 0;
  /*
   * #38786: the tool calls the server said it is running and has not said are
   * over. A server running a build of its own can be quiet for minutes and is
   * working, which VS Code's host also counts as expected silence; the clock
   * waits for it as it waits for this client.
   *
   * #38695: each of them carries its OWN clock. Disarming every bound while a call was open meant a call the server
   * never finished kept the turn alive for as long as the process did, which is the stall this issue is about. The
   * call's clock is restarted by the same chunks that restart the turn's, and by its own progress updates.
   */
  const tools = new Map<string, { readonly name: string; at: number; timer: NodeJS.Timeout | undefined }>();
  const clearTool = (id: string): void => {
    const held = tools.get(id);
    if (held?.timer !== undefined) clearTimeout(held.timer);
    tools.delete(id);
  };
  const clearTools = (): void => {
    for (const id of [...tools.keys()]) clearTool(id);
  };
  /** The bound on one open call: it names the call and the age it reached, and ends the turn rather than clearing it quietly. */
  const armTool = (id: string): NodeJS.Timeout => {
    const timer = setTimeout(() => {
      const held = tools.get(id);
      if (held === undefined) return;
      const ageMs = Date.now() - held.at;
      clearTool(id);
      const why =
        `${options.command}: the tool call ${held.name} has been open ${ageMs} ms, past its ${toolCallSilenceMs} ms bound, ` +
        `so the turn is ended`;
      // Every call still owed an answer ends with the turn: the server was working on this call, not on those.
      for (const owedCall of [...owed]) {
        owed.delete(owedCall);
        if (owedCall.timer !== undefined) clearTimeout(owedCall.timer);
        owedCall.fail(new Error(why));
      }
    }, toolCallSilenceMs);
    timer.unref();
    return timer;
  };
  const running = (update: SessionUpdate): void => {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return;
    const before = tools.size;
    const id = update.toolCallId;
    if (update.status === 'completed' || update.status === 'failed') clearTool(id);
    else if (update.sessionUpdate === 'tool_call' || update.status !== undefined) {
      const prior = tools.get(id);
      if (prior?.timer !== undefined) clearTimeout(prior.timer);
      const title = typeof update.title === 'string' && update.title.trim().length > 0 ? update.title.trim() : 'unnamed';
      tools.set(id, { name: `"${title}"`, at: Date.now(), timer: armTool(id) });
    }
    // The chunk restarted the clock before it was read; what it said decides whether one runs.
    if (tools.size !== before) quiet();
  };
  /** `heard`: the server wrote something, which is the first output of every call still owed one. */
  const quiet = (heard = false): void => {
    if (startAnswerMs <= 0) return;
    // #38695: a chunk is proof the server is working, so it restarts every open call's clock as well as the turn's.
    if (heard) {
      for (const [id, held] of tools) {
        if (held.timer !== undefined) clearTimeout(held.timer);
        tools.set(id, { name: held.name, at: Date.now(), timer: armTool(id) });
      }
    }
    for (const held of owed) {
      if (heard) held.spoke = true;
      if (held.timer !== undefined) clearTimeout(held.timer);
      held.timer = undefined;
      if (ours > 0 || tools.size > 0) continue;
      const bound = held.spoke && held.afterOutput !== undefined ? held.afterOutput : startAnswerMs;
      held.timer = setTimeout(() => {
        owed.delete(held);
        held.fail(new Error(`${options.command}: the ACP server sent nothing for ${bound} ms during ${held.step}${held.tail}`));
      }, bound);
      held.timer.unref();
    }
  };
  /**
   * This call, failed by the server's silence rather than waited on for ever.
   *
   * `afterOutput`, where given, is the bound once the call has heard anything:
   * a turn that has begun to answer and then thinks quietly is working, and is
   * given far longer than one that never started (#38786, @cto 8c171c70).
   */
  const answered = <T>(step: string, call: Promise<T>, tail = '; nothing ran', afterOutput?: number): Promise<T> => {
    if (startAnswerMs <= 0) return call;
    let fail!: (why: Error) => void;
    const silent = new Promise<never>((_resolve, no) => { fail = no; });
    const held = { step, tail, afterOutput, spoke: false, fail, timer: undefined as NodeJS.Timeout | undefined };
    owed.add(held);
    quiet();
    return Promise.race([call, silent]).finally(() => {
      owed.delete(held);
      if (held.timer !== undefined) clearTimeout(held.timer);
    });
  };

  /*
   * What the server writes, heard before the protocol reads it: a transform
   * passes each chunk through untouched and restarts the silence clock, which
   * is what makes the bound above measure quiet rather than elapsed time.
   */
  const speaking = new Transform({
    transform(chunk, _encoding, done) {
      quiet(true);
      done(undefined, chunk);
    },
  });
  child.stdout.pipe(speaking);
  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(speaking));

  const handlers = options.handlers;
  const {
    readTextFile, writeTextFile, createTerminal, terminalOutput,
    waitForTerminalExit, killTerminal, releaseTerminal, elicitation, elicitationComplete, account,
  } = handlers;

  /*
   * The handshake says what this client can answer, and only that.
   *
   * A capability advertised without an implementation is a server request
   * nobody answers, and one left unadvertised is a request a conformant server
   * never makes - so both are derived from the same handlers rather than
   * written twice.
   */
  const clientCapabilities: ClientCapabilities = {
    ...(readTextFile !== undefined || writeTextFile !== undefined
      ? {
          fs: {
            ...(readTextFile !== undefined ? { readTextFile: true } : {}),
            ...(writeTextFile !== undefined ? { writeTextFile: true } : {}),
          },
        }
      : {}),
    ...(createTerminal !== undefined ? { terminal: true } : {}),
    // Both shapes are told, because this bridge draws a form as a question and
    // a page as a link, which are two different things to answer.
    ...(elicitation !== undefined ? { elicitation: { form: {}, url: {} } } : {}),
    // A boolean option is set by the same request a select is, and the bridge
    // draws it as a control and sets it, so a server is free to offer one.
    session: { configOptions: { boolean: {} } },
  };

  /*
   * The client this bridge is, one registration per method a server may call.
   *
   * The same handlers the handshake advertises answer what it calls, so a
   * method this bridge has nothing for is one no server is told about - and a
   * server that calls it anyway gets the protocol's own "method not found"
   * rather than a request that never answers.
   */
  const app = client({ name: CLIENT_INFO.name });
  app.onNotification(methods.client.session.update, (context) => {
    /*
     * One update, routed by the session id the server named.
     *
     * A connection is opened per AHP session, so there is one conversation
     * here; the id is still passed through, because a server is free to send
     * an update for a session this bridge did not open and dropping it is
     * better than writing it into the wrong turn.
     */
    running(context.params.update);
    handlers.update(context.params.sessionId, context.params.update);
  });
  /*
   * A person's answer, or the protocol's refusal.
   */
  /** One call the server asked of this client, during which its silence does not count (#38786). */
  const waitingOnUs = <T>(answer: () => T | Promise<T>): Promise<T> => {
    ours += 1;
    quiet();
    const done = (): void => {
      ours -= 1;
      quiet();
    };
    // Called at once, as the handler was before: the order it says things in
    // against the server's own updates is part of what a client reads.
    let result: T | Promise<T>;
    try { result = answer(); }
    catch (why: unknown) {
      done();
      return Promise.reject(why);
    }
    return Promise.resolve(result).finally(done);
  };
  app.onRequest(methods.client.session.requestPermission, async (context): Promise<RequestPermissionResponse> => {
    const answer = await waitingOnUs(() => handlers.permission?.(context.params));
    if (answer === undefined || answer === 'cancelled') return REFUSED;
    return { outcome: { outcome: 'selected', optionId: answer.optionId } };
  });
  /*
   * The server's own question, and the server saying its page is done.
   *
   * The completion is a notification rather than a response, because a URL
   * elicitation is answered by whoever opened the page rather than by this
   * client: the server's own flow ends it, and this is how it says so.
   *
   * The request's own signal goes with the question, because a server that no
   * longer wants an answer says so with `$/cancel_request` and the SDK has
   * already read it: the signal is aborted, and the handler is what takes the
   * question off the chat before the server's own waiting ends.
   */
  if (elicitation !== undefined) {
    app.onRequest(methods.client.elicitation.create, (context): Promise<CreateElicitationResponse> => waitingOnUs(() => elicitation(context.params, context.signal)));
  }
  if (elicitationComplete !== undefined) {
    app.onNotification(methods.client.elicitation.complete, (context) => elicitationComplete(context.params));
  }
  if (readTextFile !== undefined) app.onRequest(methods.client.fs.readTextFile, (context) => waitingOnUs(() => readTextFile(context.params)));
  if (writeTextFile !== undefined) app.onRequest(methods.client.fs.writeTextFile, (context) => waitingOnUs(() => writeTextFile(context.params)));
  if (createTerminal !== undefined) app.onRequest(methods.client.terminal.create, (context) => waitingOnUs(() => createTerminal(context.params)));
  if (terminalOutput !== undefined) app.onRequest(methods.client.terminal.output, (context) => waitingOnUs(() => terminalOutput(context.params)));
  if (waitForTerminalExit !== undefined) app.onRequest(methods.client.terminal.waitForExit, (context) => waitingOnUs(() => waitForTerminalExit(context.params)));
  if (killTerminal !== undefined) app.onRequest(methods.client.terminal.kill, (context) => waitingOnUs(() => killTerminal(context.params)));
  if (releaseTerminal !== undefined) app.onRequest(methods.client.terminal.release, (context) => waitingOnUs(() => releaseTerminal(context.params)));

  /*
   * The account the server is signed in as, which a harness that signs in out
   * of band states with a notification of its own.
   *
   * `authStatus` in the handshake is what a server says it will do this with,
   * and that reply is read after this registration - so a status that arrived
   * first is kept and handed over once the handshake has said the server means
   * it, rather than an account being dropped for the order it arrived in.
   */
  let held: Account | undefined;
  /** Whether the handshake advertised that this server reports its sign-in. */
  let announces = false;
  const handOver = (): void => {
    if (announces && held !== undefined) account?.(held);
  };
  if (account !== undefined) {
    app.onNotification<{ authStatus?: unknown }>(
      AUTH_STATUS_UPDATE,
      (params) => bag(params) as { authStatus?: unknown },
      (context) => {
        const read = accountOf(bag(context.params).authStatus, Date.now());
        if (read === undefined) return;
        held = read;
        handOver();
      },
    );
  }

  const connection = app.connect(stream);

  /**
   * The server's `initialize` answer, kept so it is asked for once.
   *
   * A server is told what a client can do at the start of a connection and
   * never again, so `initialize` answers the held reply on a second call
   * rather than negotiating twice.
   */
  let initializeResponse: InitializeResponse | undefined;

  /**
   * One call, failed with the server's death rather than the SDK's closed stream.
   *
   * A call made after the server is gone fails at once, and one in flight fails
   * when it goes even if the stream is still held open by something the server
   * started.
   */
  const heard = <T>(call: () => Promise<T>): Promise<T> => {
    if (death !== undefined) return Promise.reject(death);
    const answered = call().catch(async (why: unknown) => {
      if (death === undefined && connection.signal.aborted) {
        await Promise.race([ended, new Promise((resolve) => { setTimeout(resolve, exitGraceMs).unref(); })]);
      }
      throw death ?? why;
    });
    return Promise.race([answered, ended.then((why): never => { throw why; })]);
  };

  /**
   * A signal to the server's whole group, which is the server and everything it
   * started.
   *
   * The negative pid is the group the server leads, because it was spawned
   * detached. A group that has already gone is not a failure to report: the
   * point of the signal was that the process is over.
   *
   * On Windows the closed stdin is the only polite ask, so a SIGTERM sends
   * nothing more, and a SIGKILL ends the server's tree with `taskkill`: `/T`
   * for what it started, `/F` because a process with no window ignores a
   * request to close.
   */
  const signal = (how: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    if (windows) {
      if (how === 'SIGKILL') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      }
      return;
    }
    try {
      process.kill(-child.pid, how);
    }
    catch {
      // Nothing left to signal.
    }
  };

  /**
   * What the server wrote on stderr, for a failure to say out loud.
   *
   * A dead server's exit can be heard before its last words have been read off
   * the pipe, and one being closed may have them in it still, so the tail
   * waits for the stream to end, bounded, because a grandchild that inherited
   * the pipe keeps it open long after the server that spawned it is gone. A ring that has dropped bytes may have kept the middle
   * of a line, so that line goes; a ring that has dropped nothing keeps every
   * byte it was given.
   */
  const stderrTail = async (): Promise<string> => {
    if (death !== undefined || closing) {
      await Promise.race([
        drained,
        new Promise((resolve) => { setTimeout(resolve, exitGraceMs).unref(); }),
      ]);
    }
    const held = stderr.toString('utf8');
    return (stderrCut ? held.slice(held.indexOf('\n') + 1) : held).trim();
  };

  const connected: AcpConnection = {
    stderrTail,
    initialize: (): Promise<InitializeResponse> => {
      if (initializeResponse !== undefined) return Promise.resolve(initializeResponse);
      const greeting: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
        clientInfo: CLIENT_INFO,
      };
      return answered('the handshake', heard(() => connection.agent.request(methods.agent.initialize, greeting))).then((reply) => {
        initializeResponse = reply;
        const says = reply.agentCapabilities?._meta?.[AUTH_STATUS];
        announces = says !== undefined && says !== null;
        handOver();
        return reply;
      });
    },
    authenticate: (request: AuthenticateRequest): Promise<AuthenticateResponse> =>
      heard(() => connection.agent.request(methods.agent.authenticate, request)),
    newSession: (request: NewSessionRequest): Promise<NewSessionResponse> =>
      answered('session/new', heard(() => connection.agent.request(methods.agent.session.new, request))),
    loadSession: (request: LoadSessionRequest): Promise<LoadSessionResponse> =>
      answered('session/load', heard(() => connection.agent.request(methods.agent.session.load, request))),
    resumeSession: (request: ResumeSessionRequest): Promise<ResumeSessionResponse> =>
      answered('session/resume', heard(() => connection.agent.request(methods.agent.session.resume, request))),
    /*
     * `session/fork`, which the SDK calls unstable.
     *
     * Sent through the SDK's own method rather than as a name, because the
     * request and the answer are typed and a fork's whole point is the id that
     * comes back. A server that never advertised the capability is never asked
     * - the session decides - so what is unstable here is only ever reached on
     * a server that has opted into it.
     */
    forkSession: (request: ForkSessionRequest): Promise<ForkSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.fork, request)),
    listSessions: (request: ListSessionsRequest): Promise<ListSessionsResponse> =>
      heard(() => connection.agent.request(methods.agent.session.list, request)),
    setSessionMode: (request: SetSessionModeRequest): Promise<SetSessionModeResponse> =>
      heard(() => connection.agent.request(methods.agent.session.setMode, request)),
    setSessionConfigOption: (request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.setConfigOption, request)),
    /*
     * `session/set_model`, which the SDK's agent no longer names.
     *
     * Sent as a method named rather than as a typed call, because that is all
     * the connection is left with, and a server that takes it is a server from
     * before the config options - which is the only kind this is asked of.
     */
    setModel: (request): Promise<unknown> => heard(() => connection.agent.request('session/set_model', request)),
    // #38786: a prompt is owed its answer as the opening is, and a server gone quiet on one ends the turn by name.
    // A tool the server never said was over belongs to the turn that is ending, not to the next one.
    prompt: (sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse> => answered('session/prompt', heard(() => connection.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt,
    })), '; the turn is ended', startAnswerMs * AFTER_OUTPUT_FACTOR).finally(() => { clearTools(); }),
    cancel: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.notify(methods.agent.session.cancel, { sessionId })),
    closeSession: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.request(methods.agent.session.close, { sessionId })).then(() => {}),
    deleteSession: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.request(methods.agent.session.delete, { sessionId })).then(() => {}),
    ended,
    close: async (): Promise<void> => {
      // The stdin end is what a well-behaved server reads as a shutdown; the
      // kill is for one that does not, and it goes to the whole group so what
      // the server started goes with it.
      closing = true;
      child.stdin.end();
      signal('SIGTERM');
      // Armed only while the server is still there, and disarmed by the wait
      // below settling: a server that took the SIGTERM is not SIGKILLed after
      // a process id that has since been reused.
      const kill = setTimeout(() => {
        if (death === undefined) signal('SIGKILL');
      }, options.killGraceMs ?? KILL_GRACE_MS);
      kill.unref();
      try {
        await ended;
      }
      finally {
        clearTimeout(kill);
      }
      // In the background: the close is over once the server is, and what it
      // left is ended a moment later.
      if (windows && child.pid !== undefined) endLeftovers(child.pid, spawnedAt);
    },
  };
  children.set(connected, child);
  return connected;
}
