import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMemory, type ComposeMachine } from '../src/compose.js';

/*
 * #39156 acceptance C, the memory half: a per-run cap with an alarm value and a kill value (host-backup: 3G/4G).
 * The fake process-compose answers a `mem` per process, so the test moves a service over the alarm, then over the
 * kill, and reads what the driver did — an alert is not enough, the kill must stop the process once.
 */

let dir: string;
let local: string;
let base: string;
let server: Server;
let machine: ComposeMachine;
let seen: string[];
let mem: Map<string, number>;

const LOCAL_ONLY = { principal: 'local:bjorn', remote: false };
const changeLog = (): Array<Record<string, unknown>> =>
  readFileSync(machine.changeLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-memory-'));
  local = join(dir, 'local.yaml');
  base = join(dir, 'base.yaml');
  writeFileSync(base, 'version: "0.5"\nprocesses: {}\n');
  writeFileSync(join(dir, 'token'), 'a-token-of-twenty-chars-or-more\n');
  writeFileSync(local, [
    'version: "0.5"',
    'processes:',
    '  backup:',
    '    command: "node backup.js"',
    '    x-hh-memory: {alarm: 3G, kill: 4G}',
    '  api:',
    '    command: "node api.js"',
    '',
  ].join('\n'));
  seen = [];
  mem = new Map([['backup', 1024 * 1024], ['api', 16 * 1024 * 1024 * 1024]]);
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/processes') {
      const data = [...mem].map(([name, m]) => ({ name, pid: 100, mem: m, status: 'Running' }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'ok' }));
  });
  const socket = join(dir, 'pc.sock');
  await new Promise<void>((done) => server.listen(socket, done));
  machine = {
    name: 'test-machine',
    configDir: dir,
    changeLog: join(dir, 'changes.jsonl'),
    backend: { kind: 'process-compose', files: [base, local], pc: { socket, tokenFile: join(dir, 'token') } },
  };
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

describe('a per-run memory cap (#39156 C)', () => {
  it('says nothing while a service is under its alarm', async () => {
    const answer = await checkMemory(machine, LOCAL_ONLY);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.alarmed).toHaveLength(0);
    expect(answer.killed).toHaveLength(0);
    expect(seen.filter((one) => one.startsWith('PATCH /process/stop/'))).toHaveLength(0);
  });

  it('alarms once above the alarm value and never for a service without a cap', async () => {
    mem.set('backup', 3.5 * 1024 ** 3);
    const first = await checkMemory(machine, LOCAL_ONLY);
    if (!first.ok) throw new Error(first.message);
    expect(first.alarmed).toEqual([{ name: 'backup', bytes: Math.round(3.5 * 1024 ** 3), alarmBytes: 3 * 1024 ** 3 }]);
    const second = await checkMemory(machine, LOCAL_ONLY);
    if (!second.ok) throw new Error(second.message);
    expect(second.alarmed).toHaveLength(0);
    expect(seen.filter((one) => one.startsWith('PATCH /process/stop/'))).toHaveLength(0);
  });

  it('stops the process once above the kill value and records it', async () => {
    mem.set('backup', 4.5 * 1024 ** 3);
    const answer = await checkMemory(machine, LOCAL_ONLY);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.killed).toEqual([{ name: 'backup', bytes: Math.round(4.5 * 1024 ** 3), killBytes: 4 * 1024 ** 3 }]);
    expect(seen.filter((one) => one === 'PATCH /process/stop/backup')).toHaveLength(1);
    const line = changeLog().find((one) => one.op === 'memory-kill');
    expect(line).toMatchObject({ name: 'backup', memory: { killBytes: 4 * 1024 ** 3 } });
    const again = await checkMemory(machine, LOCAL_ONLY);
    if (!again.ok) throw new Error(again.message);
    expect(again.killed).toHaveLength(0);
    expect(seen.filter((one) => one === 'PATCH /process/stop/backup')).toHaveLength(1);
  });
});
