/*
 * What `ahpd join` does, seen from the hub's own end.
 *
 * The hub is a port that answers every dial and holds every line, so each case
 * is what the node sent and what it did with what it was sent. The node is the
 * real program in another process, and so is the host each session is served
 * by: the point of these cases is the pipe between the two, and a stand-in on
 * either side would be the thing being tested.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { MAIN, REPO, daemonEnv, gone, home, spawned } from './cli.js';

interface Frame {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

/** A socket the node dialled, from the hub's end. */
interface Held {
  /** The path and query it asked for, which tells a control socket from a session's. */
  url: string;
  socket: WebSocket;
  /** Whether the socket is still open here. */
  live: boolean;
  send(value: unknown): void;
  /** The next frame the node sends, waiting for it to arrive. */
  frame(): Promise<Frame>;
  close(): void;
}

/** The hubs a case made, closed when it ends. */
const hubs: Array<{ close(): Promise<void> }> = [];

/** A hub that is nothing but a port: every dial is answered and every line held. */
const hub = async (): Promise<{ url: string; held: Held[]; close(): Promise<void> }> => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((done) => { server.once('listening', done); });
  const held: Held[] = [];
  server.on('connection', (socket: WebSocket, request: { url?: string }) => {
    const waiting: Frame[] = [];
    const asked: Array<(frame: Frame) => void> = [];
    const one: Held = {
      url: request.url ?? '',
      socket,
      live: true,
      send: (value) => { socket.send(JSON.stringify(value)); },
      frame: () => new Promise((done) => {
        const ready = waiting.shift();
        if (ready !== undefined) { done(ready); return; }
        asked.push(done);
      }),
      close: () => { socket.close(); },
    };
    socket.on('message', (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as Frame;
      const reader = asked.shift();
      if (reader !== undefined) reader(frame);
      else waiting.push(frame);
    });
    socket.on('close', () => { one.live = false; });
    held.push(one);
  });
  const port = (server.address() as AddressInfo).port;
  const made = {
    url: `ws://127.0.0.1:${String(port)}`,
    held,
    close: async (): Promise<void> => {
      for (const one of held) one.socket.terminate();
      await new Promise((done) => { server.close(() => { done(undefined); }); });
    },
  };
  hubs.push(made);
  return made;
};

/** The node, as the process that joins. */
interface Joining {
  child: ChildProcess;
  /** Everything it said on stderr so far, its own lines and its sessions'. */
  said(): string;
  /** The code it left with, once it has left. */
  ended: Promise<number | null>;
  kill(): void;
}

const joinUp = (args: readonly string[], unset: readonly string[] = []): Joining => {
  const child = spawn(process.execPath, [MAIN, 'join', ...args], {
    cwd: REPO,
    env: daemonEnv(
      // The loader is named by its absolute URL, because a session host is
      // started in the node's own folder and a relative `--import` would be
      // resolved there, where there is no scripts folder.
      { NODE_OPTIONS: `--conditions development --import ${pathToFileURL(join(REPO, 'scripts/dev.mjs')).href}` },
      ['AHPD_TOKEN', ...unset],
    ),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawned.push(child.pid as number);
  let said = '';
  child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
  // stdout is not a log here, and a pipe nobody drains is a node that stops
  // writing once it is full.
  child.stdout.resume();
  return {
    child,
    said: () => said,
    ended: new Promise((done) => { child.once('exit', (code) => { done(code); }); }),
    kill: () => { child.kill('SIGKILL'); },
  };
};

/** What the node did next, waited for, because it is another process. */
const until = async <T>(found: () => T | undefined, what: string, node?: Joining): Promise<T> => {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ready = found();
    if (ready !== undefined) return ready;
    if (Date.now() > deadline) {
      // What the node itself said is the one thing a case that waited cannot
      // see, and a case that fails here has nothing else to go on.
      const state = node === undefined ? '' : ` (exit ${String(node.child.exitCode)}, signal ${String(node.child.signalCode)}. It said:\n${node.said()})`;
      throw new Error(`the node never ${what}${state}`);
    }
    await new Promise((wait) => { setTimeout(wait, 25); });
  }
};

/**
 * The socket the node dialled, waited for.
 *
 * A session's socket is the one naming its id. A control socket is named by its
 * place instead, because a node dials a new one after each drop and the case is
 * which of them carried what.
 */
const dialled = async (
  held: Held[],
  wanted: { control: number } | { data: string },
  node?: Joining,
): Promise<Held> => {
  const match = (): Held | undefined => ('data' in wanted
    ? held.find((one) => one.url.includes(`data=${wanted.data}`))
    : held.filter((one) => !one.url.includes('data='))[wanted.control]);
  return await until(match, 'dialled it', node);
};

/** The fixture that says what it is when a host loads it, put where only the node's folder can name it. */
const fixture = (workdir: string): void => {
  mkdirSync(workdir, { recursive: true });
  cpSync(join(import.meta.dirname, 'fixtures', 'plugin-env'), join(workdir, 'plugin-env'), { recursive: true });
};

/** The pid a host announced on the node's stderr, waited for: it is what a case watches to see the host end. */
const announced = (node: Joining): Promise<number> => until(
  () => {
    const pid = /pid (\d+)/u.exec(node.said())?.[1];
    return pid === undefined ? undefined : Number(pid);
  },
  'started a host',
);

it('says its workdir on hello and serves a session in that folder', async () => {
  const at = await hub();
  const workdir = join(home, 'node');
  fixture(workdir);
  const node = joinUp([at.url, '--token', 'node-token', '--workdir', workdir]);

  const control = await dialled(at.held, { control: 0 }, node);
  const hello = await control.frame();
  expect(hello.method).toBe('node/hello');
  const params = hello.params as unknown as { versions: { ahpd: string; protocol: string[] }; workdir: string };
  // The folder the hub is told is the node's, so the hub never sends one of its own.
  expect(params.workdir).toBe(workdir);
  expect(params.versions.ahpd).toMatch(/^\d+\.\d+\.\d+/u);
  expect(params.versions.protocol.length).toBeGreaterThan(0);
  // The credential is the node's own token, on the socket the node opened.
  expect(control.url).toContain('tkn=node-token');

  control.send({ jsonrpc: '2.0', id: 2, method: 'node/open', params: { id: 's1', plugins: ['./plugin-env/index.ts'] } });
  // Answered as a request, so the hub knows the session exists before it speaks.
  expect(await control.frame()).toMatchObject({ id: 2, result: { id: 's1' } });

  const data = await dialled(at.held, { data: 's1' });
  expect(data.url).toContain('tkn=node-token');
  data.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientId: 'join-test', protocolVersions: ['0.9.0'] } });
  const answered = await data.frame();
  expect(answered.id).toBe(1);
  expect(typeof (answered.result as { protocolVersion?: unknown } | undefined)?.protocolVersion).toBe('string');

  // The host is the node's own, started in the node's folder: the fixture's
  // relative spec resolved there, and what it said is on the node's stderr.
  const pid = await announced(node);
  await until(() => (node.said().includes('AHPD_SERVICE unset') ? true : undefined), 'loaded the fixture plugin');

  // A session's socket that closes takes its host with it.
  data.close();
  await gone(pid);
  node.kill();
  await at.close();
}, 60_000);

it('serves two live session hosts on the same joined node', async () => {
  const at = await hub();
  const workdir = join(home, 'node');
  fixture(workdir);
  const node = joinUp([at.url, '--token', 'node-token', '--workdir', workdir]);
  const control = await dialled(at.held, { control: 0 }, node);
  expect(await control.frame()).toMatchObject({ id: 1, method: 'node/hello' });
  control.send({ jsonrpc: '2.0', id: 1, result: {} });

  const open = async (request: number, id: string, innerId: string): Promise<Held> => {
    control.send({ jsonrpc: '2.0', id: request, method: 'node/open', params: {
      id, plugins: ['./plugin-env/index.ts'], scope: { hostId: 'hub-a', innerId },
    } });
    expect(await control.frame()).toMatchObject({ id: request, result: { id } });
    const data = await dialled(at.held, { data: id }, node);
    const closed = new Promise<never>((_resolve, reject) => {
      const fail = (): void => reject(new Error(`session host ${id} closed before initialization. Node stderr:\n${node.said()}`));
      if (data.socket.readyState !== WebSocket.OPEN) fail();
      else data.socket.once('close', fail);
    });
    const answered = Promise.race([data.frame(), closed]);
    data.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      clientId: 'join-test', protocolVersions: ['0.9.0'],
    } });
    expect(await answered).toMatchObject({ id: 1, result: { protocolVersion: expect.any(String) } });
    return data;
  };

  const first = await open(2, 'stream-a', 'inner-a');
  const second = await open(3, 'stream-b', 'inner-b');
  expect(first.live).toBe(true);
  expect(second.live).toBe(true);
  await at.close();
}, 60_000);

it('closes a session socket when its host exits', async () => {
  const at = await hub();
  const workdir = join(home, 'node');
  fixture(workdir);
  const node = joinUp([at.url, '--token', 'node-token', '--workdir', workdir]);
  const control = await dialled(at.held, { control: 0 });
  await control.frame();
  control.send({ jsonrpc: '2.0', id: 2, method: 'node/open', params: { id: 's2', plugins: ['./plugin-env/index.ts'] } });
  const data = await dialled(at.held, { data: 's2' });
  const pid = await announced(node);

  // The other end of the same rule: a host that goes is a socket the hub is not
  // left holding.
  process.kill(pid, 'SIGKILL');
  await until(() => (data.live ? undefined : true), 'closed the session socket');
  node.kill();
  await at.close();
}, 60_000);

it('stops with the hub\'s sentence when the hub refuses its version', async () => {
  const at = await hub();
  const node = joinUp([at.url, '--token', 'node-token']);
  const control = await dialled(at.held, { control: 0 });
  await control.frame();
  // What task 02's hub answers a hello with when the node's ahpd is too old.
  control.send({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32000, message: 'This node runs ahpd 0.14.0, and this hub needs 0.14.1 or newer to resume by id. Update ahpd on the node.' },
  });
  expect(await node.ended).toBe(1);
  expect(node.said()).toContain('Update ahpd on the node.');
  await at.close();
}, 60_000);

it('dials the hub again when the control socket drops', async () => {
  const at = await hub();
  const node = joinUp([at.url, '--token', 'node-token']);
  const first = await dialled(at.held, { control: 0 });
  await first.frame();
  first.close();

  // A hub that went is a hub the node waits for: the second socket says hello
  // with the same versions and the same folder.
  const again = await dialled(at.held, { control: 1 });
  const hello = await again.frame();
  expect(hello.method).toBe('node/hello');
  node.kill();
  await at.close();
}, 60_000);

it('keeps a session and its host when the control socket drops', async () => {
  const at = await hub();
  const workdir = join(home, 'node');
  fixture(workdir);
  const node = joinUp([at.url, '--token', 'node-token', '--workdir', workdir]);
  const first = await dialled(at.held, { control: 0 });
  await first.frame();
  first.send({ jsonrpc: '2.0', id: 2, method: 'node/open', params: { id: 's3', plugins: ['./plugin-env/index.ts'] } });
  const data = await dialled(at.held, { data: 's3' });
  const pid = await announced(node);

  // A hub that went and came back: the node dials again, and the session it
  // already opened is served by the host it already started, not by a second
  // one. That is what makes a hub restart something a node waits out.
  first.close();
  const again = await dialled(at.held, { control: 1 }, node);
  expect((await again.frame()).method).toBe('node/hello');
  expect(data.live).toBe(true);
  expect(() => { process.kill(pid, 0); }).not.toThrow();

  // And the host behind it still answers, which is the session a turn lands on.
  data.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientId: 'join-test', protocolVersions: ['0.9.0'] } });
  const answered = await data.frame();
  expect(answered.id).toBe(1);
  expect(typeof (answered.result as { protocolVersion?: unknown } | undefined)?.protocolVersion).toBe('string');

  node.kill();
  await at.close();
}, 60_000);

it('refuses to join with no token, and dials nothing', async () => {
  const at = await hub();
  const node = joinUp([at.url]);
  expect(await node.ended).toBe(2);
  expect(node.said()).toContain('needs a token');
  expect(at.held).toHaveLength(0);
  await at.close();
}, 60_000);

it('stops when the hub answers and refuses the token', async () => {
  // A hub that is there and turns the upgrade away, as one with no node by
  // that token does - and answers the plain request the same way, which is how
  // a joiner tells a refusal from a port nothing is listening on.
  const plain = createServer((_request, response) => { response.writeHead(401); response.end('A connection token is required'); });
  await new Promise((done) => { plain.listen(0, '127.0.0.1', () => { done(undefined); }); });
  const refused = new WebSocketServer({ server: plain, verifyClient: (_info, done) => { done(false, 401, 'no'); } });
  const port = (plain.address() as AddressInfo).port;
  const node = joinUp([`ws://127.0.0.1:${String(port)}`, '--token', 'not-a-token']);
  expect(await node.ended).toBe(1);
  expect(node.said()).toContain('refused this node');

  await new Promise((done) => { refused.close(() => { plain.close(() => { done(undefined); }); }); });
}, 60_000);

// The hub a case made holds sockets of its own, which outlive the hook that
// removes the folder.
afterEach(async () => {
  for (const one of hubs.splice(0)) {
    try { await one.close(); }
    catch { /* it was already closed by the case */ }
  }
});
