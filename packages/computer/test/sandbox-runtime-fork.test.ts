import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SandboxConfigValue } from '@ahpd/sdk';
import { hostSandboxPlace, hostSandboxRefusal, sandboxedCommand, sandboxSettingsOf, writeSandboxSettings } from '../src/sandbox.js';

/*
 * `@ahpio/sandbox-runtime` run for real on Linux: a chat that allows the whole
 * network reaches a host on no list, a chat that allows none does not, and
 * both keep the chat's filesystem rules. The host is a server on this
 * machine's loopback, which the runtime's network namespace cuts off.
 * On CI the runtime must start; elsewhere a host without bubblewrap, socat or
 * ripgrep skips these cases.
 */

let folder: string;
let server: Server;
let url: string;
let refusal: string | undefined;

beforeAll(async () => {
  // Under /tmp, not the suite's TMPDIR: the runtime makes its sockets in the
  // sandbox's folder, and a socket's path holds 108 bytes at most.
  folder = mkdtempSync(join(process.platform === 'linux' ? '/tmp' : tmpdir(), 'ahpd-srt-'));
  server = createServer((_request, response) => response.end('reached'));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  refusal = process.platform === 'linux' ? await hostSandboxRefusal(folder) : 'not Linux';
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(folder, { recursive: true, force: true });
});

/** Runs `line` by `sh -c` inside the runtime with the chat's sandbox settings, and answers its exit code and output. */
const run = async (sandbox: SandboxConfigValue, line: string): Promise<{ code: number | null; out: string }> => {
  const place = hostSandboxPlace(`fork-${Math.random()}`, folder);
  const configPath = writeSandboxSettings(place, (path) => sandboxSettingsOf(sandbox, place, folder, path));
  const env = Object.fromEntries(Object.entries(process.env).filter((one): one is [string, string] => one[1] !== undefined));
  const spawned = sandboxedCommand(place, configPath, { command: 'sh', args: ['-c', line], cwd: folder, env }, false);
  return new Promise((done, failed) => {
    const child = spawn(spawned.command, spawned.args, { env: spawned.env, cwd: spawned.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('error', failed);
    child.on('close', (code) => done({ code, out }));
  });
};

const fetchLine = (): string =>
  `${JSON.stringify(process.execPath)} -e 'fetch(process.argv[1]).then((r) => r.text()).then((t) => console.log(t), () => { console.log("refused"); process.exit(3); })' ${JSON.stringify(url)}`;

const ready = (skip: () => void): void => {
  if (refusal === undefined) return;
  if (process.env['CI'] !== undefined && process.platform === 'linux') throw new Error(`The sandbox runtime cannot start on CI: ${refusal}`);
  skip();
};

it('reaches a host on no list when the chat allows the whole network', async ({ skip }) => {
  ready(skip);
  const answer = await run({ allowNetwork: true }, fetchLine());
  expect(answer.out).toContain('reached');
  expect(answer.code).toBe(0);
}, 30_000);

it('does not reach that host when the chat allows no domain', async ({ skip }) => {
  ready(skip);
  const answer = await run({ allowedNetworkDomains: [] }, fetchLine());
  expect(answer.out).toContain('refused');
  expect(answer.code).toBe(3);
}, 30_000);

it('keeps a read denial when the chat allows the whole network', async ({ skip }) => {
  ready(skip);
  const secret = join(folder, 'secret');
  mkdirSync(secret, { recursive: true });
  writeFileSync(join(secret, 'key'), 'hidden');
  const line = `cat ${JSON.stringify(join(secret, 'key'))} || echo denied`;
  const answer = await run({ allowNetwork: true, 'fileSystem.linux': { denyRead: [secret] } }, line);
  expect(answer.out).not.toContain('hidden');
  expect(answer.out).toContain('denied');
  expect(answer.code).toBe(0);
}, 30_000);
