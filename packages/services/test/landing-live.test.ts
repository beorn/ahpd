import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLandings, type ComposeMachine } from '../src/compose.js';
import { ROUTES, pcRequest } from '../src/pc.js';

/*
 * #39156 acceptance A, against the real supervisor: a resident is restarted onto a promoted landing, both pids are
 * recorded, and the elapsed time is measured rather than promised. Everything but the promotion is the shipped path:
 * real process-compose, the driver's own `checkLandings`, the real /processes socket. The unit test proves the
 * bookkeeping against a fake; this proves what process-compose actually does, and prints the measured N.
 */

let dir: string;
afterEach(() => { if (dir !== undefined) rmSync(dir, { recursive: true, force: true }); });

/** process-compose as the test's own proof: the real binary, if this machine can name it. */
const processCompose = (): string | undefined => {
  const fromPath = spawnSync('sh', ['-c', 'command -v process-compose'], { encoding: 'utf8' });
  if (fromPath.status === 0 && fromPath.stdout.trim() !== '') return fromPath.stdout.trim();
  if (process.env['PROCESS_COMPOSE_BIN'] !== undefined) return process.env['PROCESS_COMPOSE_BIN'];
  const store = '/nix/store';
  if (!existsSync(store)) return undefined;
  const found = readdirSync(store).filter((name) => /-process-compose-\d/u.test(name));
  return found.map((name) => join(store, name, 'bin', 'process-compose')).find((path) => existsSync(path));
};

/** Promote a landing the way a deploy does: a new link beside the old one, renamed over it. */
const promote = (link: string, target: string): void => {
  const next = `${link}.next`;
  symlinkSync(target, next);
  renameSync(next, link);
};

describe('a promotion restarts the resident, measured against real process-compose (#39156 A)', () => {
  let pc: ChildProcess | undefined;
  afterEach(() => { pc?.kill('SIGKILL'); pc = undefined; });

  it('restarts onto the new landing and records both pids and the elapsed time', async () => {
    const binary = processCompose();
    if (binary === undefined) {
      throw new Error('process-compose was not found: set PROCESS_COMPOSE_BIN or put it on PATH. This test is what measures N on the real supervisor.');
    }
    dir = mkdtempSync(join(tmpdir(), 'pc-landing-'));
    for (const version of ['v1', 'v2']) {
      mkdirSync(join(dir, version));
      writeFileSync(join(dir, version, 'MARKER'), version);
    }
    const link = join(dir, 'current');
    symlinkSync(join(dir, 'v1'), link);
    const file = join(dir, 'pc.yaml');
    writeFileSync(file, `processes:
  resident:
    command: "sleep 600"
    x-hh-landing: ${link}
`);
    const machine: ComposeMachine = {
      name: 'landing-live', configDir: dir, changeLog: join(dir, 'changes.jsonl'),
      backend: { kind: 'process-compose', files: [file], pc: { socket: join(dir, 'pc.sock') } },
    };
    pc = spawn(binary, ['-f', file, '--unix-socket', machine.backend.pc.socket, '--use-uds', '-t=false', '-L', join(dir, 'pc.log'), 'up'],
      { stdio: 'ignore', env: { ...process.env, PC_DISABLE_TUI: 'true' } });

    const pidOf = async (): Promise<number | undefined> => {
      try {
        const [method, path] = ROUTES.processes();
        const answer = await pcRequest(machine.backend.pc, method, path);
        const rows = (answer.body as { data?: Array<{ name?: string; pid?: number; status?: string }> }).data ?? [];
        return rows.find((one) => one.name === 'resident' && one.status === 'Running')?.pid;
      }
      catch {
        // The socket is not there yet: process-compose is still starting.
        return undefined;
      }
    };
    let started: number | undefined;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline && started === undefined) {
      started = await pidOf();
      if (started === undefined) await new Promise((done) => setTimeout(done, 200));
    }
    expect(started, 'process-compose never reported a running resident').toBeTypeOf('number');

    const first = await checkLandings(machine, { principal: 'test', remote: false });
    if (!first.ok) throw new Error(first.message);
    expect(first.restarted).toEqual([]);

    promote(link, join(dir, 'v2'));
    const second = await checkLandings(machine, { principal: 'test', remote: false });
    if (!second.ok) throw new Error(second.message);
    expect(second.restarted).toHaveLength(1);
    const restart = second.restarted[0]!;
    // The acceptance's number, printed where the run keeps it.
    console.info(`#39156 A: promotion -> new pid in ${restart.elapsedMs} ms (old ${restart.oldPid}, new ${restart.newPid})`);
    expect(restart.from).toContain('/v1');
    expect(restart.to).toContain('/v2');
    expect(restart.oldPid).toBe(started);
    expect(restart.newPid).toBeTypeOf('number');
    expect(restart.newPid).not.toBe(started);
    expect(restart.elapsedMs).toBeLessThan(15_000);

    const logged = readFileSync(machine.changeLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged.find((one) => one['op'] === 'landing-restart')?.['landing']).toMatchObject({ oldPid: started, newPid: restart.newPid });

    // Nothing moved: the next check restarts nothing.
    const third = await checkLandings(machine, { principal: 'test', remote: false });
    if (!third.ok) throw new Error(third.message);
    expect(third.restarted).toEqual([]);
  }, 60_000);
});
