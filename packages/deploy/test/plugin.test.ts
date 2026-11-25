import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPLACED_IN, apply, deployMethods, METHODS } from '../src/index.js';
import { gitSync } from '../../../tools/git.ts';
import type { DeployDeclaration, DeployHost, DeployMethod, DeployRefusal, DeployRequest } from '../src/index.js';

/** A machine's state folder, and nothing else: the plugin's own paths are the driver's. */
const machine = () => mkdtempSync(join(tmpdir(), 'ahpd-deploy-plugin-'));

const ON = { allowRemoteCommands: true, allowRoomAsks: false };
const OFF = { allowRemoteCommands: false, allowRoomAsks: false };

/** The methods over one machine, with the steps recorded instead of started: this suite is about the answer, not git. */
const methods = (
  stateDir: string,
  started: DeployRequest[] = [],
  over: Partial<{ switches: typeof ON; services: readonly string[]; stateDir: string; declaration: DeployDeclaration | DeployRefusal }> = {},
) => {
  const found = deployMethods({
    stateDir: over.stateDir ?? stateDir,
    switches: () => over.switches ?? ON,
    services: () => over.services ?? ['web', 'api'],
    declaration: () => over.declaration ?? { repo: '/src/web', ref: 'main' },
    start: (request) => {
      started.push(request);
      // The child takes the lock as `ahpd deploy` does; the answer is not given until it does.
      const root = join((over.stateDir ?? stateDir), 'deploy', request.service);
      setTimeout(() => {
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, 'deploy.lock'), JSON.stringify({ deployId: request.deployId, step: 'resolve', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: '' }) + '\n');
      }, 40);
    },
  });
  const call = async (method: string, params: Record<string, unknown>) => {
    const one = found[method] as DeployMethod;
    return await one.handle(params, undefined, 'test-client') as Record<string, unknown> & Partial<DeployRefusal>;
  };
  return { run: (params: Record<string, unknown>) => call('run', params), report: (params: Record<string, unknown>) => call('report', params), started };
};

/** A repo the driver can actually resolve against: one commit on main. */
const repoFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-deploy-plugin-repo-'));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]): string =>
    gitSync(args, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();
  git('init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'file.txt'), 'one\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'one');
  return repo;
};

const runOf = (service = 'web', version = 'main') => ({ service, version });

describe('the deploy plugin (#38276 slice 2)', () => {
  it('answers started with the deploy id and the resolved sha, without taking the lock itself', async () => {
    const stateDir = machine();
    const repo = repoFixture();
    const one = methods(stateDir, [], { declaration: { repo, ref: 'main' } });
    const answer = await one.run(runOf());
    expect(answer).toMatchObject({ ok: true, state: 'started', service: 'web' });
    expect(String(answer['sha'])).toMatch(/^[0-9a-f]{40}$/u);
    expect(one.started).toHaveLength(1);
    expect(one.started[0]?.deployId).toBe(answer['deployId']);
    expect(one.started[0]?.version).toBe(answer['sha']);
    // The lock that exists is the child's, under the id the answer named - the parent claimed nothing itself.
    const report = await one.report({ service: 'web' });
    expect(report).toMatchObject({ ok: true, running: { deployId: answer['deployId'] } });
  });

  it('refuses a service this machine does not run, naming the ones it does', async () => {
    const answer = await methods(machine()).run(runOf('mailer'));
    expect(answer).toMatchObject({ ok: false, code: 'UNKNOWN_SERVICE' });
    expect(String(answer['message'])).toContain('web, api');
  });

  it('kills a child that outlives the lock budget, so no lock can appear after the refusal (#38276)', async () => {
    // @cto 2026-11-25: a child that takes the lock after we answered DRIVER_FAILED would deploy behind a caller told
    // the deploy never began. The refusal is only true if the child is stopped, so the budget is a kill, not a wait.
    const stateDir = machine();
    const repo = repoFixture();
    const root = join(stateDir, 'deploy', 'web');
    let killed = false;
    let late: ReturnType<typeof setTimeout> | undefined;
    const found = deployMethods({
      stateDir,
      switches: () => ON,
      services: () => ['web'],
      declaration: () => ({ repo, ref: 'main' }),
      waitForLockMs: 120,
      start: () => ({
        // Never ends on its own, and would take the lock well after the budget.
        whenExited: new Promise<number | null>(() => {}),
        killGroup: () => {
          killed = true;
          if (late !== undefined) clearTimeout(late);
        },
      }),
    });
    late = setTimeout(() => {
      mkdirSync(root, { recursive: true });
      const lock = { deployId: 'late', step: 'resolve', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: '' };
      writeFileSync(join(root, 'deploy.lock'), JSON.stringify(lock) + '\n');
    }, 400);
    const run = (found.run as DeployMethod).handle({ service: 'web', version: 'main' }, undefined, 'test-client') as Promise<Record<string, unknown> & Partial<DeployRefusal>>;
    const answer = await run;
    expect(answer['code']).toBe('DRIVER_FAILED');
    expect(String(answer['message'])).toContain('killed after 120 ms');
    expect(killed).toBe(true);
    // Past the child's own moment: nothing took the lock behind the refusal.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(join(root, 'deploy.lock'))).toBe(false);
    const lines = readFileSync(join(root, 'deploy.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.at(-1)).toMatchObject({ event: 'not started', reason: 'killed after 120 ms without taking the lock' });
  }, 20_000);

  it('says the lock was taken when the kill lands after the last check (#38276, @cto 2026-11-25)', async () => {
    // The kill is not instant: a child can win the lock between the last poll and the signal. The journal must then
    // name the lock it left instead of claiming no lock was ever taken, and the next deploy clears the stale one.
    const stateDir = machine();
    const repo = repoFixture();
    const root = join(stateDir, 'deploy', 'web');
    const found = deployMethods({
      stateDir,
      switches: () => ON,
      services: () => ['web'],
      declaration: () => ({ repo, ref: 'main' }),
      waitForLockMs: 120,
      start: (request) => ({
        whenExited: new Promise<number | null>(() => {}),
        killGroup: () => {
          // The race this test is about: the lock appears as the signal is sent, with a pid that is already gone.
          mkdirSync(root, { recursive: true });
          const lock = { deployId: request.deployId, step: 'resolve', pid: 999_999, startedAt: new Date().toISOString(), from: null, to: '' };
          writeFileSync(join(root, 'deploy.lock'), JSON.stringify(lock) + '\n');
        },
      }),
    });
    const answer = await (found.run as DeployMethod).handle({ service: 'web', version: 'main' }, undefined, 'test-client') as Record<string, unknown> & Partial<DeployRefusal>;
    expect(answer['code']).toBe('DRIVER_FAILED');
    expect(String(answer['message'])).toContain('after taking the lock at step resolve');
    expect(String(answer['message'])).toContain('the next deploy clears it');
    const lines = readFileSync(join(root, 'deploy.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.at(-1)).toMatchObject({ event: 'outcome unknown', step: 'resolve', reason: 'killed after taking the lock; the lock it left is stale and the next deploy clears it' });
    // Left in place, not silently removed: the next claim names the step and clears it through the pid check.
    expect(existsSync(join(root, 'deploy.lock'))).toBe(true);
  }, 20_000);

  it('refuses a second deploy by the running deploy id', async () => {
    const stateDir = machine();
    const root = join(stateDir, 'deploy', 'web');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'deploy.lock'), JSON.stringify({ deployId: 'running-one', step: 'check', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: 'abc' }) + '\n');
    const answer = await methods(stateDir).run(runOf());
    expect(answer).toMatchObject({ ok: false, code: 'RUNNING' });
    expect(String(answer['message'])).toContain('running-one');
  });

  it('refuses every deploy while the machine has allowRemoteCommands off, and says where to set it', async () => {
    const answer = await methods(machine(), [], { switches: OFF }).run(runOf());
    expect(answer).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
    expect(String(answer['message'])).toContain('allowRemoteCommands');
  });

  it('refuses a version the declared ref cannot reach, before anything starts', async () => {
    const answer = await methods(machine(), [], { declaration: { repo: '/nonexistent/repo', ref: 'main' } }).run(runOf());
    expect(answer).toMatchObject({ ok: false, code: 'UNREACHABLE' });
  });

  it('takes {service, version} and nothing else, so a caller can never choose a command (#38549)', async () => {
    const one = methods(machine());
    for (const extra of [{ repo: '/src/web' }, { beforeSwitch: { command: 'x' } }, { keep: 1 }, { build: { command: 'bun' } }]) {
      const answer = await one.run({ ...runOf(), ...extra });
      expect(answer).toMatchObject({ ok: false, code: 'INVALID' });
      expect(String(answer['message'])).toContain(Object.keys(extra)[0]!);
    }
    expect(one.started).toHaveLength(0);
  });

  it('refuses a service whose record carries no deploy declaration, naming the fields it must have (#38549)', async () => {
    const noDeclaration = { ok: false as const, code: 'NO_DEPLOY_DECLARATION' as const, message: 'web carries no deploy declaration: its record must name deploy.repo, deploy.ref and any steps (build, before_switch, check) before it can be deployed from elsewhere' };
    const one = methods(machine(), [], { declaration: noDeclaration });
    const answer = await one.run(runOf());
    expect(answer).toMatchObject({ ok: false, code: 'NO_DEPLOY_DECLARATION' });
    expect(String(answer['message'])).toContain('deploy.repo');
    expect(one.started).toHaveLength(0);
  });

  it('report on a machine that never deployed says so instead of answering empty', async () => {
    const answer = await methods(machine()).report({ service: 'web' });
    expect(answer).toMatchObject({ ok: true, current: null, running: null, last: null, deployed: false });
  });

  it('report reads the last journal line, which carries the outcome, steps and timings but never output', async () => {
    const stateDir = machine();
    const root = join(stateDir, 'deploy', 'web');
    mkdirSync(join(root, 'releases', 'abc'), { recursive: true });
    writeFileSync(join(root, 'deploy.log'), [
      JSON.stringify({ event: 'started', deployId: 'one', from: null, to: 'abc' }),
      JSON.stringify({ event: 'finished', deployId: 'one', outcome: 'switched, checked', steps: [{ step: 'build', ok: true, ms: 1200, code: 0 }] }),
    ].join('\n') + '\n');
    const answer = await methods(stateDir).report({ service: 'web' });
    expect(answer).toMatchObject({ ok: true, deployed: true, last: { event: 'finished', outcome: 'switched, checked' } });
    expect(JSON.stringify(answer)).not.toContain('output');
  });
});

describe('the deploy plugin as ahpd loads it', () => {
  const host = () => {
    const registered = new Map<string, DeployMethod>();
    const channels: string[] = [];
    const providers: string[] = [];
    const published: { uri: string; type: string }[] = [];
    const alerts: string[] = [];
    const one: DeployHost = {
      configDir: machine(),
      registerMethod: (name, method) => registered.set(name, method),
      registerGrants: () => {},
      registerChannel: (scheme) => {
        channels.push(scheme);
        return { publish: (uri, action) => published.push({ uri, type: action.type }) };
      },
      registerResourceProvider: (scheme) => { providers.push(scheme); },
      alert: (alert) => alerts.push(alert.text),
    };
    return { one, registered, channels, providers, published, alerts };
  };

  it('registers the channel and the reads, and refuses the retired methods by name', async () => {
    const { one, registered, alerts } = host();
    apply(one, {});
    expect([...registered.keys()].sort()).toEqual([...METHODS].sort());
    expect(alerts[0]).toContain('files');
    for (const method of METHODS) {
      const refused = registered.get(method)?.handle({ service: 'web', version: 'main' }, undefined, 'test-client') as Promise<unknown>;
      await expect(refused).rejects.toMatchObject({ code: -32601, data: { release: REPLACED_IN } });
    }
  });

  it('with the machine\'s own files and socket, serves x-hh-deploys:// and hh-deploys:// under the deploy grant', () => {
    const { one, registered, channels, providers, alerts } = host();
    apply(one, { files: [join(one.configDir, 'base.yaml'), join(one.configDir, 'machine.yaml')], socket: join(one.configDir, 'pc.sock') });
    expect(channels).toEqual(['x-hh-deploys']);
    expect(providers).toEqual(['hh-deploys']);
    expect(alerts).toHaveLength(0);
    // The retired names still exist, so a caller on the old grants is told what replaced them.
    expect(registered.get('x-ahpd/deploy/run')?.grant).toBe('deploy:read');
  });
});

describe('two runs of the same service at once', () => {
  it('give exactly one started and one RUNNING, because an answer waits for the lock its child holds', async () => {
    const stateDir = machine();
    const repo = repoFixture();
    const root = join(stateDir, 'deploy', 'web');
    let first = true;
    const found = deployMethods({
      stateDir,
      switches: () => ON,
      services: () => ['web'],
      declaration: () => ({ repo, ref: 'main' }),
      waitForLockMs: 2_000,
      start: (request) => {
        // The child takes the lock a moment after it is spawned, as `ahpd deploy` does; only the first one wins.
        if (!first) return;
        first = false;
        setTimeout(() => {
          mkdirSync(root, { recursive: true });
          writeFileSync(join(root, 'deploy.lock'), JSON.stringify({ deployId: request.deployId, step: 'resolve', pid: process.pid, startedAt: new Date().toISOString(), from: null, to: '' }) + '\n');
        }, 60);
      },
    });
    const run = (params: Record<string, unknown>) =>
      (found.run as DeployMethod).handle(params, undefined, 'test-client') as Promise<Record<string, unknown>>;
    const [one, two] = await Promise.all([run(runOf()), run(runOf())]);
    const kinds = [one['state'] ?? one['code'], two['state'] ?? two['code']];
    expect(kinds.filter((kind) => kind === 'started')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'RUNNING')).toHaveLength(1);
  }, 20_000);
});
