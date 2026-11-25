import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, deployMethods, METHODS } from '../src/index.js';
import { gitSync } from '../../../tools/git.ts';
import type { DeployHost, DeployMethod, DeployRefusal, DeployRequest } from '../src/index.js';

/** A machine's state folder, and nothing else: the plugin's own paths are the driver's. */
const machine = () => mkdtempSync(join(tmpdir(), 'ahpd-deploy-plugin-'));

const ON = { allowRemoteCommands: true, allowRoomAsks: false };
const OFF = { allowRemoteCommands: false, allowRoomAsks: false };

/** The methods over one machine, with the steps recorded instead of started: this suite is about the answer, not git. */
const methods = (
  stateDir: string,
  started: DeployRequest[] = [],
  over: Partial<{ switches: typeof ON; services: readonly string[]; stateDir: string }> = {},
) => {
  const found = deployMethods({
    stateDir: over.stateDir ?? stateDir,
    switches: () => over.switches ?? ON,
    services: () => over.services ?? ['web', 'api'],
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
  return { run: (params: Record<string, unknown>) => call('x-ahpd/deploy/run', params), report: (params: Record<string, unknown>) => call('x-ahpd/deploy/report', params), started };
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

const runOf = (service = 'web', version = 'main', extra: Record<string, unknown> = {}) => ({ service, version, repo: '/src/web', ...extra });

describe('the deploy plugin (#38276 slice 2)', () => {
  it('answers started with the deploy id and the resolved sha, without taking the lock itself', async () => {
    const stateDir = machine();
    const repo = repoFixture();
    const one = methods(stateDir);
    const answer = await one.run(runOf('web', 'main', { repo }));
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
    const answer = await methods(machine()).run(runOf('web', 'main', { repo: '/nonexistent/repo' }));
    expect(answer).toMatchObject({ ok: false, code: 'UNREACHABLE' });
  });

  it('a misspelt or unknown key, a plain env value, and keep below 2 are each refused by name', async () => {
    const one = methods(machine());
    const typo = await one.run(runOf('web', 'main', { beforeSwitch: { command: 'x' } }));
    expect(typo).toMatchObject({ ok: false, code: 'INVALID' });
    expect(String(typo['message'])).toContain('beforeSwitch');

    const plain = await one.run(runOf('web', 'main', { build: { command: 'bun', env: { TOKEN: 'plain-value' } } }));
    expect(plain).toMatchObject({ ok: false, code: 'INVALID' });
    expect(String(plain['message'])).toContain('secret reference');

    const oneKept = await one.run(runOf('web', 'main', { keep: 1 }));
    expect(oneKept).toMatchObject({ ok: false, code: 'INVALID' });
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
    const alerts: string[] = [];
    const one: DeployHost = {
      configDir: machine(),
      registerMethod: (name, method) => registered.set(name, method),
      registerGrants: () => {},
      alert: (alert) => alerts.push(alert.text),
    };
    return { one, registered, alerts };
  };

  it('says what is missing, by name, instead of registering methods that would run a command', async () => {
    const { one, registered, alerts } = host();
    apply(one, {});
    expect([...registered.keys()].sort()).toEqual([...METHODS].sort());
    expect(alerts[0]).toContain('files');
    for (const method of METHODS) {
      const answer = await (registered.get(method) as DeployMethod).handle({ service: 'web', version: 'main', repo: '/src/web' }, undefined, 'test-client');
      expect(answer).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    }
  });

  it('with the machine\'s own files and socket, registers both methods under their grants', () => {
    const { one, registered, alerts } = host();
    apply(one, { files: [join(one.configDir, 'base.yaml'), join(one.configDir, 'machine.yaml')], socket: join(one.configDir, 'pc.sock') });
    expect([...registered.keys()].sort()).toEqual([...METHODS].sort());
    expect(alerts).toHaveLength(0);
    expect(registered.get('x-ahpd/deploy/run')?.grant).toBe('deploy:run');
    expect(registered.get('x-ahpd/deploy/report')?.grant).toBe('deploy:read');
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
      (found['x-ahpd/deploy/run'] as DeployMethod).handle(params, undefined, 'test-client') as Promise<Record<string, unknown>>;
    const [one, two] = await Promise.all([run(runOf('web', 'main', { repo })), run(runOf('web', 'main', { repo }))]);
    const kinds = [one['state'] ?? one['code'], two['state'] ?? two['code']];
    expect(kinds.filter((kind) => kind === 'started')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'RUNNING')).toHaveLength(1);
  }, 20_000);
});
