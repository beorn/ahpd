import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSchedules, type ComposeMachine } from '../src/compose.js';

/*
 * #39156 acceptance C, the catch-up half: process-compose keeps no last-run time, so a cron slot that passed while
 * the driver was down has to be answered once from the entry's own schedule. The fake process-compose is started
 * and restarted by the driver; the test moves the persisted pass time behind a slot and reads whether one run
 * followed, and none on the next pass.
 */

let dir: string;
let machine: ComposeMachine;
let server: Server;
let seen: string[];
let status: string;
let restartStatus: number;

const LOCAL_ONLY = { principal: 'local:bjorn', remote: false };
const NOON_PST = new Date('2026-11-28T12:10:00Z');
/** 02:10 PST on Nov 28; the 02:00 PST slot that day is 10:00Z. */
const SLOT = '2026-11-28T10:00:00.000Z';
const changeLog = (): Array<Record<string, unknown>> =>
  readFileSync(machine.changeLog, 'utf8').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-schedule-'));
  writeFileSync(join(dir, 'base.yaml'), 'version: "0.5"\nprocesses: {}\n');
  writeFileSync(join(dir, 'token'), 'a-token-of-twenty-chars-or-more\n');
  writeFileSync(join(dir, 'local.yaml'), [
    'version: "0.5"',
    'processes:',
    '  nightly:',
    '    command: "node backup.js"',
    '    schedule: {cron: "0 2 * * *", timezone: America/Los_Angeles}',
    '  api:',
    '    command: "node api.js"',
    '',
  ].join('\n'));
  seen = [];
  status = 'Completed';
  restartStatus = 200;
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/process/restart/nightly') {
      if (restartStatus !== 200) {
        res.writeHead(restartStatus, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'no such process' }));
        return;
      }
      status = 'Running';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'nightly' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/processes') {
      const data = [{ name: 'nightly', pid: 111, status }, { name: 'api', pid: 222, status: 'Running' }];
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
    backend: { kind: 'process-compose', files: [join(dir, 'base.yaml'), join(dir, 'local.yaml')], pc: { socket, tokenFile: join(dir, 'token') } },
  };
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

const state = (): void => {
  writeFileSync(join(dir, 'schedule.json'), JSON.stringify({
    checkedAt: '2026-11-28T09:00:00.000Z',
    runs: { nightly: '2026-11-27T10:00:00.000Z' },
  }));
};

describe('a cron slot missed while the driver was down (#39156 C)', () => {
  it('records a baseline on the first pass instead of running anything', async () => {
    const answer = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.caughtUp).toHaveLength(0);
    expect(seen.filter((one) => one.includes('/restart/'))).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf8'))).toEqual({
      checkedAt: NOON_PST.toISOString(),
      runs: { nightly: SLOT },
    });
  });

  it('runs a slot that passed after the last pass, once, and records it', async () => {
    state();
    const first = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!first.ok) throw new Error(first.message);
    expect(first.caughtUp).toEqual([{ name: 'nightly', slot: SLOT, lastSeen: '2026-11-28T09:00:00.000Z', ran: true }]);
    expect(seen.filter((one) => one.includes('/restart/'))).toEqual(['POST /process/restart/nightly']);
    const line = changeLog().find((one) => one['op'] === 'schedule-catchup');
    expect(line?.['missedRun']).toEqual({ name: 'nightly', slot: SLOT, lastSeen: '2026-11-28T09:00:00.000Z', ran: true });
    // The slot is accounted for: the next pass runs nothing, even though the process shows as running.
    const second = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!second.ok) throw new Error(second.message);
    expect(second.caughtUp).toHaveLength(0);
    expect(seen.filter((one) => one.includes('/restart/'))).toHaveLength(1);
  });

  it('does not run a slot it saw go by while watching', async () => {
    writeFileSync(join(dir, 'schedule.json'), JSON.stringify({
      checkedAt: '2026-11-28T10:01:00.000Z',
      runs: { nightly: '2026-11-27T10:00:00.000Z' },
    }));
    const answer = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.caughtUp).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf8'))).toEqual({
      checkedAt: NOON_PST.toISOString(),
      runs: { nightly: SLOT },
    });
  });

  it('takes no second run when the service is already running', async () => {
    state();
    status = 'Running';
    const answer = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!answer.ok) throw new Error(answer.message);
    // Already running is already the run: nothing is attempted, and the slot is accounted for so it is not retried.
    expect(answer.caughtUp).toHaveLength(0);
    expect(seen.filter((one) => one.includes('/restart/'))).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf8'))).toMatchObject({ runs: { nightly: SLOT } });
  });

  it('records a refusal rather than retrying the same slot', async () => {
    state();
    restartStatus = 500;
    const first = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!first.ok) throw new Error(first.message);
    expect(first.caughtUp[0]).toMatchObject({ name: 'nightly', ran: false });
    expect(changeLog().find((one) => one['op'] === 'schedule-catchup')?.['refused']).toMatchObject({ code: 'PC_REFUSED' });
    seen = [];
    const second = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!second.ok) throw new Error(second.message);
    expect(second.caughtUp).toHaveLength(0);
    expect(seen.filter((one) => one.includes('/restart/'))).toHaveLength(0);
  });

  it('ignores a service with no schedule', async () => {
    state();
    const answer = await checkSchedules(machine, LOCAL_ONLY, NOON_PST);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.checked).toBe(1);
    expect(answer.caughtUp.map((one) => one.name)).toEqual(['nightly']);
  });
});
