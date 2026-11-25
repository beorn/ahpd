import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, deployMethods, METHODS } from '../src/index.js';
import type { DeployHost, DeployMethod, DeployOptions, DeployRefusal } from '../src/index.js';

/** A machine's state folder, and nothing else: the plugin's own paths are the driver's. */
const machine = () => mkdtempSync(join(tmpdir(), 'ahpd-deploy-plugin-'));

const never = (): undefined => undefined;

/** The methods over one machine, with the steps recorded instead of run: this suite is about the answer, not git. */
const methods = (stateDir: string, started: DeployOptions[] = [], permit = never) => {
  const found = deployMethods({ stateDir, permit, start: (going) => started.push(going) });
  const call = async (method: string, params: Record<string, unknown>) => {
    const one = found[method] as DeployMethod;
    return await one.handle(params, undefined, 'test-client') as Record<string, unknown> & Partial<DeployRefusal>;
  };
  return { run: (params: Record<string, unknown>) => call('x-ahpd/deploy/run', params), report: (params: Record<string, unknown>) => call('x-ahpd/deploy/report', params), started };
};

const runOf = (service = 'web', version = 'main') => ({ service, version, repo: '/src/web' });

describe('the deploy plugin (#38276 slice 2)', () => {
  it('answers started with the id it has already locked, so a second call in the same second is refused by that id', async () => {
    const stateDir = machine();
    const one = methods(stateDir);
    const first = await one.run(runOf());
    expect(first).toMatchObject({ ok: true, state: 'started', service: 'web' });
    const lock = JSON.parse(readFileSync(join(stateDir, 'deploy', 'web', 'deploy.lock'), 'utf8')) as { deployId: string };
    expect(lock.deployId).toBe(first['deployId']);

    const second = await one.run(runOf());
    expect(second).toMatchObject({ ok: false, code: 'RUNNING' });
    expect(String(second['message'])).toContain(String(first['deployId']));
    expect(one.started).toHaveLength(1);
  });

  it('a lock left by a process that is gone is refused as outcome unknown, naming the step, and never resumed', async () => {
    const stateDir = machine();
    const root = join(stateDir, 'deploy', 'web');
    mkdirSync(root, { recursive: true });
    // A pid that cannot be a live process here, so the lock is a dead one.
    writeFileSync(join(root, 'deploy.lock'), `${JSON.stringify({ deployId: 'gone', step: 'build', pid: 2147483647, startedAt: '', from: null, to: 'abc' })}\n`);
    const one = methods(stateDir);
    const answer = await one.run(runOf());
    expect(answer).toMatchObject({ ok: false, code: 'OUTCOME_UNKNOWN' });
    expect(String(answer['message'])).toContain('build');
    expect(one.started).toHaveLength(0);
    expect(existsSync(join(root, 'deploy.lock'))).toBe(false);
    const journal = readFileSync(join(root, 'deploy.log'), 'utf8');
    expect(journal).toContain('outcome unknown');
  });

  it('a misspelt or unknown key is refused by name, never ignored', async () => {
    const one = methods(machine());
    const answer = await one.run({ ...runOf(), beforeSwitch: { command: 'x' } });
    expect(answer).toMatchObject({ ok: false, code: 'INVALID' });
    expect(String(answer['message'])).toContain('beforeSwitch');
    expect(one.started).toHaveLength(0);
  });

  it('a migration value deploy does not know is refused with the value in the sentence', async () => {
    const one = methods(machine());
    const answer = await one.run({ ...runOf(), migrations: 'drop-and-recreate' });
    expect(answer).toMatchObject({ ok: false, code: 'INVALID' });
    expect(String(answer['message'])).toContain('drop-and-recreate');
  });

  it('carries the declaration through as the driver reads it, commands as words and no shell', async () => {
    const stateDir = machine();
    const one = methods(stateDir);
    await one.run({
      ...runOf('web', 'v1.2.3'),
      ref: 'release',
      migrations: 'expand-only',
      build: { command: 'bun', args: ['run', 'build'] },
      before_switch: { command: './pre.sh' },
      check: { command: 'bun', args: ['run', 'check'] },
      keep: 4,
    });
    const going = one.started[0];
    expect(going?.version).toBe('v1.2.3');
    expect(going?.declaration).toEqual({
      repo: '/src/web',
      ref: 'release',
      migrations: 'expand-only',
      build: { command: 'bun', args: ['run', 'build'] },
      beforeSwitch: { command: './pre.sh' },
      check: { command: 'bun', args: ['run', 'check'] },
      keep: 4,
    });
  });

  it('hands the machine\'s gate to the driver rather than deciding by itself', async () => {
    const gate = (step: string): string | undefined => (step === 'build' ? 'this machine does not run build commands' : undefined);
    const one = methods(machine(), undefined, gate);
    await one.run(runOf());
    expect(one.started[0]?.permit).toBe(gate);
  });

  it('report on a machine that never deployed says so instead of answering empty', async () => {
    const answer = await methods(machine()).report({ service: 'web' });
    expect(answer).toMatchObject({ ok: true, current: null, running: null, last: null, deployed: false });
  });

  it('report reads the last journal line, which is the outcome of the last deploy', async () => {
    const stateDir = machine();
    const root = join(stateDir, 'deploy', 'web');
    mkdirSync(join(root, 'releases', 'abc'), { recursive: true });
    writeFileSync(join(root, 'deploy.log'), [
      JSON.stringify({ event: 'started', deployId: 'one', from: null, to: 'abc' }),
      JSON.stringify({ event: 'finished', deployId: 'one', outcome: 'switched, unchecked' }),
    ].join('\n') + '\n');
    const answer = await methods(stateDir).report({ service: 'web' });
    expect(answer).toMatchObject({ ok: true, last: { event: 'finished', outcome: 'switched, unchecked' }, deployed: true });
  });
});

describe('the deploy plugin without the machine\'s gate', () => {
  const host = () => {
    const registered = new Map<string, DeployMethod>();
    const alerts: string[] = [];
    const one: DeployHost = {
      configDir: machine(),
      registerMethod: (name, method) => registered.set(name, method),
      registerGrants: () => {},
      alert: (alert) => alerts.push(alert.text),
    };
    return { one, registered, alerts };
  };

  it('registers both methods and answers each by name instead of running a command', async () => {
    const { one, registered, alerts } = host();
    apply(one, {});
    expect([...registered.keys()].sort()).toEqual([...METHODS].sort());
    expect(alerts[0]).toContain('allowRemoteCommands');
    for (const method of METHODS) {
      const answer = await (registered.get(method) as DeployMethod).handle({ service: 'web', version: 'main', repo: '/src/web' }, undefined, 'test-client');
      expect(answer).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    }
  });

  it('with a gate, applies the two methods and nothing else', () => {
    const { one, registered, alerts } = host();
    apply(one, { permit: never });
    expect([...registered.keys()].sort()).toEqual([...METHODS].sort());
    expect(alerts).toHaveLength(0);
  });
});
