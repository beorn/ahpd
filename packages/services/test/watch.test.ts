import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listServices, type ComposeMachine } from '../src/compose.js';
import { driftFacts } from '../src/drift.js';
import { CUT_COMMAND_REF, GAVE_UP_REF, readOutcomes, watchAlerts, writeOutcomes } from '../src/watch.js';

/*
 * @cto 8f8fafce, the #38120 supervisor ruling: process-compose stays the format,
 * and two of its silences become alerts the services driver owns.
 * (2) A program it stopped restarting after max_restarts is `Completed` with a
 *     non-zero exit, and nothing above process-compose sees it.
 * (5) An unquoted command holding " #" is cut by YAML at the "#", and runs less
 *     than it says; the trial's tick program lost its redirect this way.
 * The last block runs the real process-compose through the trial's crash shape.
 */

let dir: string;
afterEach(() => { if (dir !== undefined) rmSync(dir, { recursive: true, force: true }); });

const machineFor = (text: string, socket = 'unused.sock'): ComposeMachine => {
  dir = mkdtempSync(join(tmpdir(), 'pcw-'));
  const file = join(dir, 'pc.yaml');
  writeFileSync(file, text);
  return { name: 'test-machine', configDir: dir, changeLog: join(dir, 'changes.jsonl'), backend: { kind: 'process-compose', files: [file], pc: { socket: join(dir, socket) } } };
};

const CRASHER = `processes:
  crasher:
    command: "sh -c 'exit 3'"
    availability:
      restart: on_failure
      backoff_seconds: 1
      max_restarts: 2
    x-hh-source:
      kind: program
      id: crash-test
  keeper:
    command: "sleep 120"
`;

describe('a command YAML cut at " #" (condition 5)', () => {
  it('makes the entry read-only, says what runs, and raises one alert per entry', () => {
    const machine = machineFor(`processes:
  noted:
    command: run --flag # starts it
  hashed:
    command: echo a #b
  quoted:
    command: "echo x # kept"
  quotedNote:
    command: "echo y" # a note after a quoted command cuts nothing
  folded:
    command: >
      echo z # kept in a block scalar
  above:
    # a comment on its own line cuts nothing
    command: echo ok
`);
    const listing = listServices(machine);
    if (!listing.ok) throw new Error(listing.message);
    expect(listing.services.map((one) => one.name).sort()).toEqual(['above', 'folded', 'quoted', 'quotedNote']);
    expect(listing.readOnly.map((one) => one.name).sort()).toEqual(['hashed', 'noted']);
    const reason = listing.readOnly.find((one) => one.name === 'hashed')!.reason;
    expect(reason).toContain('process-compose runs only "echo a"');
    expect(reason).toContain('quote the whole command');
    const alerts = watchAlerts('test-machine', listing, []);
    expect(alerts.map((one) => one.ref)).toEqual([`${CUT_COMMAND_REF}hashed`, `${CUT_COMMAND_REF}noted`]);
    expect(alerts.every((one) => one.level === 'error')).toBe(true);
    expect(alerts[1]!.text).toContain('process-compose runs only "run --flag"');
  });
});

describe('a program process-compose gave up on (condition 2)', () => {
  const listing = (): ReturnType<typeof listServices> => {
    const answer = listServices(machineFor(CRASHER));
    if (!answer.ok) throw new Error(answer.message);
    return answer;
  };

  it('raises one named alert, with its owner, at Completed + non-zero exit + restarts == max_restarts', () => {
    const alerts = watchAlerts('test-machine', listing(), [
      { name: 'crasher', status: 'Completed', exitCode: 3, restarts: 2 },
      { name: 'keeper', status: 'Running', exitCode: 0, restarts: 0 },
    ]);
    expect(alerts).toEqual([{
      level: 'error',
      ref: `${GAVE_UP_REF}crasher`,
      text: 'process-compose on test-machine gave up on crasher: it exited 3 after 2 restarts (max_restarts 2) and will not be '
        + 'started again until someone starts it; its owner is program crash-test (x-hh-source)',
    }]);
  });

  it('stays quiet while it is still restarting, when it exited 0, and when the state is unknown', () => {
    const answer = listing();
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Restarting', exitCode: 3, restarts: 1 }])).toEqual([]);
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 3, restarts: 1 }])).toEqual([]);
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 0, restarts: 2 }])).toEqual([]);
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', restarts: 2 }])).toEqual([]);
    expect(watchAlerts('test-machine', answer, 'cannot reach process-compose')).toEqual([]);
    expect(watchAlerts('test-machine', answer, undefined)).toEqual([]);
  });

  it('never judges max_restarts 0 (unlimited) or a policy that does not restart', () => {
    for (const availability of ['restart: on_failure\n      max_restarts: 0', 'restart: "no"\n      max_restarts: 2']) {
      const answer = listServices(machineFor(`processes:\n  crasher:\n    command: "false"\n    availability:\n      ${availability}\n`));
      if (!answer.ok) throw new Error(answer.message);
      expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 1, restarts: 2 }])).toEqual([]);
    }
  });

  it('says no owner is recorded when the entry has no x-hh-source', () => {
    const answer = listServices(machineFor('processes:\n  crasher:\n    command: "false"\n    availability:\n      restart: always\n      max_restarts: 1\n'));
    if (!answer.ok) throw new Error(answer.message);
    const [alert] = watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 1, restarts: 1 }]);
    expect(alert!.text).toContain('no x-hh-source names who put it here');
  });
});

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

describe('the real process-compose, through the crash shape', () => {
  let pc: ChildProcess | undefined;
  afterEach(() => { pc?.kill('SIGKILL'); pc = undefined; });

  it('reports a given-up program as Completed with its exit code and restarts, and the driver alerts on it', async () => {
    const binary = processCompose();
    if (binary === undefined) {
      throw new Error('process-compose was not found: set PROCESS_COMPOSE_BIN or put it on PATH. This test is what proves the give-up alert matches what process-compose really reports.');
    }
    const machine = machineFor(CRASHER, 'pc.sock');
    pc = spawn(binary, ['-f', machine.backend.files[0]!, '--unix-socket', machine.backend.pc.socket, '--use-uds', '-t=false', '-L', join(dir, 'pc.log'), 'up'],
      { stdio: 'ignore', env: { ...process.env, PC_DISABLE_TUI: 'true' } });
    const listing = listServices(machine);
    let alerts: ReturnType<typeof watchAlerts> = [];
    let last: unknown;
    const until = Date.now() + 25_000;
    while (Date.now() < until) {
      const facts = await driftFacts(machine, join(dir, 'drift.json'));
      last = facts.running;
      alerts = watchAlerts('test-machine', listing, facts.running);
      if (alerts.length > 0) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    expect(alerts.map((one) => one.ref), `last process list: ${JSON.stringify(last)}`).toEqual([`${GAVE_UP_REF}crasher`]);
    expect(alerts[0]!.text).toContain('it exited 3 after 2 restarts (max_restarts 2)');
    expect((last as Array<{ name: string; status: string }>).find((one) => one.name === 'keeper')!.status).toBe('Running');
  }, 40_000);
});

describe('a declared report-only exit code (#39156 C)', () => {
  const REPORTING = `processes:
  reporter:
    command: "sh -c 'exit 3'"
    availability:
      restart: on_failure
      max_restarts: 2
    x-hh-reports: [3]
`;
  it('takes no incident path for a code the entry declares, and one for a code it does not', () => {
    const answer = listServices(machineFor(REPORTING));
    if (!answer.ok) throw new Error(answer.message);
    expect(answer.services.find((one) => one.name === 'reporter')?.reports).toEqual([3]);
    expect(watchAlerts('test-machine', answer, [{ name: 'reporter', status: 'Completed', exitCode: 3, restarts: 2 }])).toEqual([]);
    const undeclared = watchAlerts('test-machine', answer, [{ name: 'reporter', status: 'Completed', exitCode: 4, restarts: 2 }]);
    expect(undeclared.map((one) => one.ref)).toEqual([`${GAVE_UP_REF}reporter`]);
  });
});

/*
 * @dev/21's measured replay (#39156 C): process-compose answers a re-run in flight with `Running` and a zero exit_code,
 * so reading the alert from the current row alone cleared a gave-up program the moment it was started again. The
 * terminal failure is carried instead, and only a later terminal success clears it.
 */
describe('a gave-up program across a re-run (#39156 C, @dev/21)', () => {
  const listing = (): ReturnType<typeof listServices> => {
    const answer = listServices(machineFor(CRASHER));
    if (!answer.ok) throw new Error(answer.message);
    return answer;
  };

  it('keeps the failure while it runs again, and through an unreadable process list', () => {
    const answer = listing();
    const held: Record<string, { exit: number; restarts: number; at: string }> = {};
    const failed = watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 3, restarts: 2 }], held);
    expect(failed).toHaveLength(1);
    expect(held['crasher']).toMatchObject({ exit: 3, restarts: 2 });
    // A re-run in flight: Running with a bare zero must not clear it.
    const running = watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Running', exitCode: 0, restarts: 0 }], held);
    expect(running.map((one) => one.ref)).toEqual([`${GAVE_UP_REF}crasher`]);
    // The process list cannot be read at all: silence is not success either.
    const unreadable = watchAlerts('test-machine', answer, 'cannot reach process-compose', held);
    expect(unreadable.map((one) => one.ref)).toEqual([`${GAVE_UP_REF}crasher`]);
  });

  it('clears only on a terminal success, and never on a non-terminal failure', () => {
    const answer = listing();
    const held: Record<string, { exit: number; restarts: number; at: string }> = { crasher: { exit: 3, restarts: 2, at: '2026-11-28T07:00:00.000Z' } };
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 3, restarts: 1 }], held))
      .toHaveLength(1);
    expect(held['crasher']).toBeDefined();
    expect(watchAlerts('test-machine', answer, [{ name: 'crasher', status: 'Completed', exitCode: 0, restarts: 0 }], held))
      .toEqual([]);
    expect(held['crasher']).toBeUndefined();
  });

  it('clears on a code the entry declares report-only', () => {
    const answer = listServices(machineFor(`processes:
  reporter:
    command: "false"
    availability:
      restart: on_failure
      max_restarts: 2
    x-hh-reports: [3]
`));
    if (!answer.ok) throw new Error(answer.message);
    const held: Record<string, { exit: number; restarts: number; at: string }> = { reporter: { exit: 5, restarts: 2, at: '2026-11-28T07:00:00.000Z' } };
    expect(watchAlerts('test-machine', answer, [{ name: 'reporter', status: 'Completed', exitCode: 3, restarts: 2 }], held)).toEqual([]);
    expect(held['reporter']).toBeUndefined();
  });

  it('drops a failure for a service the process list no longer holds', () => {
    const answer = listing();
    const held: Record<string, { exit: number; restarts: number; at: string }> = { crasher: { exit: 3, restarts: 2, at: '2026-11-28T07:00:00.000Z' } };
    expect(watchAlerts('test-machine', answer, [{ name: 'keeper', status: 'Running' }], held)).toEqual([]);
    expect(held['crasher']).toBeUndefined();
  });

  it('round-trips the held failures through the outcomes file', () => {
    const machine = machineFor(CRASHER);
    const file = join(machine.configDir, 'outcomes.json');
    const held = { crasher: { exit: 3, restarts: 2, at: '2026-11-28T07:00:00.000Z' } };
    writeOutcomes(file, held);
    expect(readOutcomes(file)).toEqual(held);
    writeFileSync(file, '{"crasher": {"exit": "three"}}');
    expect(readOutcomes(file)).toEqual({});
    rmSync(file);
    expect(readOutcomes(file)).toEqual({});
  });
});
