import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkLandings, type ComposeMachine } from '../src/compose.js';

/*
 * #39156 acceptance A: a promoted landing restarts the resident, and the old and new pids are recorded.
 * The test is the acceptance, not a mock of it: the fake process-compose answers a pid per name and a different one
 * after the restart route is hit, so "restarted" is proved by the pid the driver reads afterwards.
 */

let dir: string;
let local: string;
let base: string;
let server: Server;
let machine: ComposeMachine;
let seen: string[];
/** pids by name, and what they become once /process/restart/<name> is hit. */
let pids: Map<string, number>;
let next: Map<string, number>;

const LOCAL_ONLY = { principal: 'local:bjorn', remote: false };
const changeLog = (): Array<Record<string, unknown>> =>
  readFileSync(machine.changeLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-landing-'));
  local = join(dir, 'local.yaml');
  base = join(dir, 'base.yaml');
  writeFileSync(base, 'version: "0.5"\nprocesses: {}\n');
  writeFileSync(join(dir, 'token'), 'a-token-of-twenty-chars-or-more\n');
  mkdirSync(join(dir, 'releases', 'a'), { recursive: true });
  mkdirSync(join(dir, 'releases', 'b'), { recursive: true });
  symlinkSync(join(dir, 'releases', 'a'), join(dir, 'landing-web'));
  writeFileSync(local, [
    'version: "0.5"',
    'processes:',
    '  web:',
    '    command: "node server.js"',
    `    x-hh-landing: ${join(dir, 'landing-web')}`,
    '  api:',
    '    command: "node api.js"',
    '',
  ].join('\n'));
  seen = [];
  pids = new Map([['web', 111], ['api', 222]]);
  next = new Map([['web', 333], ['api', 444]]);
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const restart = /^\/process\/restart\/(.+)$/u.exec(req.url ?? '');
    if (req.method === 'POST' && restart !== null) {
      const name = decodeURIComponent(restart[1]!);
      const after = next.get(name);
      if (after !== undefined) pids.set(name, after);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'ok' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/processes') {
      const data = [...pids].map(([name, pid]) => ({ name, pid, status: 'Running' }));
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

describe('a promoted landing (#39156 A)', () => {
  it('records the baseline first and restarts nothing', async () => {
    const answer = await checkLandings(machine, LOCAL_ONLY);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.restarted).toHaveLength(0);
    expect(seen.filter((one) => one.startsWith('POST /process/restart/'))).toHaveLength(0);
  });

  it('restarts the resident when the landing moves, and records both pids and the elapsed time', async () => {
    const first = await checkLandings(machine, LOCAL_ONLY);
    if (!first.ok) throw new Error(first.message);
    // The promotion: the landing symlink now points at release b.
    rmSync(join(dir, 'landing-web'));
    symlinkSync(join(dir, 'releases', 'b'), join(dir, 'landing-web'));
    const answer = await checkLandings(machine, LOCAL_ONLY);
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.restarted).toHaveLength(1);
    expect(answer.restarted[0]).toMatchObject({ name: 'web', oldPid: 111, newPid: 333 });
    expect(typeof answer.restarted[0]!.elapsedMs).toBe('number');
    expect(seen.filter((one) => one === 'POST /process/restart/web')).toHaveLength(1);
    expect(seen.filter((one) => one === 'POST /process/restart/api')).toHaveLength(0);
    const line = changeLog().find((one) => one.op === 'landing-restart');
    expect(line).toMatchObject({ name: 'web', landing: { oldPid: 111, newPid: 333 } });
  });
});
