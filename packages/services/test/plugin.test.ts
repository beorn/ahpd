import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginHost, PluginMethod } from '../../sdk/src/types/plugin.js';
import type { Caller, Machine, Refusal } from '../src/compose.js';
import type { DriftAlert } from '../src/drift.js';
import { METHODS, apply, callerOf, servicesMethods, showDrift, type Driver, type ServicesHost, type ServicesMethod } from '../src/plugin.js';

/*
 * #38277 slice 2: the driver as ahpd methods (@cto). Each method calls the
 * driver with the caller the host named, always remote (the handler is told
 * nothing about the socket a call came in on), and answers the driver's
 * answer, a refusal included, unchanged.
 */

// The host the daemon hands a plugin has what this plugin reads, and a method it
// serves is one the daemon can register: checked by the compiler, not at run time.
const _host = (host: PluginHost): ServicesHost => host;
const _method = (method: ServicesMethod): PluginMethod => method;
void _host; void _method;

const machine: Machine = {
  name: 'test-machine', files: ['/m/local.yaml'], configDir: '/m', changeLog: '/m/changes.jsonl', pc: { socket: '/m/pc.sock' },
};

/** A driver that records each call and answers what a case set. */
const recording = () => {
  const calls: Array<{ verb: string; caller?: Caller; params?: unknown }> = [];
  let answer: unknown = { ok: true };
  const driver = {
    list: (_machine: Machine) => { calls.push({ verb: 'list' }); return answer; },
    put: async (_machine: Machine, caller: Caller, params: unknown) => { calls.push({ verb: 'put', caller, params }); return answer; },
    remove: async (_machine: Machine, caller: Caller, params: unknown) => { calls.push({ verb: 'remove', caller, params }); return answer; },
    control: async (_machine: Machine, caller: Caller, params: unknown) => { calls.push({ verb: 'control', caller, params }); return answer; },
    logs: async (_machine: Machine, caller: Caller, params: unknown) => { calls.push({ verb: 'logs', caller, params }); return answer; },
  } as unknown as Driver;
  return { driver, calls, answer: (next: unknown) => { answer = next; } };
};

describe('servicesMethods', () => {
  it('serves the seven x-ahpd/services methods the manifest lists', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { ahpd: { contracts: { methods: string[] } } };
    expect(Object.keys(servicesMethods(machine))).toEqual(METHODS);
    expect(manifest.ahpd.contracts.methods).toEqual(METHODS);
  });

  it('calls each driver function with the caller the host named, remote', async () => {
    const { driver, calls } = recording();
    const methods = servicesMethods(machine, driver);
    const owner = 'plugin:hightea-pipe';
    const remote = { principal: owner, remote: true };
    await methods['x-ahpd/services/list']!.handle({}, undefined, 'c1', owner);
    await methods['x-ahpd/services/put']!.handle({ service: { name: 'web', command: 'x' }, ifVersion: 'v' }, undefined, 'c1', owner);
    await methods['x-ahpd/services/remove']!.handle({ name: 'web', ifVersion: 'v' }, undefined, 'c1', owner);
    await methods['x-ahpd/services/start']!.handle({ name: 'web' }, undefined, 'c1', owner);
    await methods['x-ahpd/services/stop']!.handle({ name: 'web' }, undefined, 'c1', owner);
    await methods['x-ahpd/services/restart']!.handle({ name: 'web' }, undefined, 'c1', owner);
    await methods['x-ahpd/services/logs']!.handle({ name: 'web', limit: 5 }, undefined, 'c1', owner);
    expect(calls).toEqual([
      { verb: 'list' },
      { verb: 'put', caller: remote, params: { service: { name: 'web', command: 'x' }, ifVersion: 'v' } },
      { verb: 'remove', caller: remote, params: { name: 'web', ifVersion: 'v' } },
      { verb: 'control', caller: remote, params: { name: 'web', verb: 'start' } },
      { verb: 'control', caller: remote, params: { name: 'web', verb: 'stop' } },
      { verb: 'control', caller: remote, params: { name: 'web', verb: 'restart' } },
      { verb: 'logs', caller: remote, params: { name: 'web', limit: 5 } },
    ]);
  });

  it('names the caller by owner, then person, then client id, and never as local', () => {
    expect(callerOf({ id: 'bjorn' }, 'c1', 'root:host')).toEqual({ principal: 'root:host', remote: true });
    expect(callerOf({ id: 'bjorn' }, 'c1', undefined)).toEqual({ principal: 'user:bjorn', remote: true });
    expect(callerOf(undefined, 'vscode-1', undefined)).toEqual({ principal: 'client:vscode-1', remote: true });
  });

  it('answers the driver\'s refusal unchanged, and records no write for it', async () => {
    const { driver, answer } = recording();
    const wrote: string[] = [];
    const methods = servicesMethods(machine, driver, (file) => { wrote.push(file); });
    const refusal: Refusal = { ok: false, code: 'REMOTE_COMMANDS_OFF', message: 'this machine does not accept commands from Hightea; set allowRemoteCommands locally' };
    answer(refusal);
    for (const name of METHODS) {
      expect(await methods[name]!.handle({ name: 'web' }, undefined, 'c1', 'plugin:hightea-pipe')).toBe(refusal);
    }
    expect(wrote).toEqual([]);
  });

  it('records the file and hash a put or remove wrote, and not a put that changed nothing', async () => {
    const { driver, answer } = recording();
    const wrote: Array<[string, string]> = [];
    const methods = servicesMethods(machine, driver, (file, hash) => { wrote.push([file, hash]); });
    answer({ ok: true, ifVersion: 'h1', file: '/m/local.yaml', service: { name: 'web', command: 'x' }, changed: true });
    await methods['x-ahpd/services/put']!.handle({}, undefined, 'c1');
    answer({ ok: true, ifVersion: 'h1', file: '/m/local.yaml', service: { name: 'web', command: 'x' }, changed: false });
    await methods['x-ahpd/services/put']!.handle({}, undefined, 'c1');
    answer({ ok: true, ifVersion: 'h2', file: '/m/local.yaml' });
    await methods['x-ahpd/services/remove']!.handle({}, undefined, 'c1');
    expect(wrote).toEqual([['/m/local.yaml', 'h1'], ['/m/local.yaml', 'h2']]);
  });

  it('answers a driver that throws as a refusal, never a throw into ahpd', async () => {
    const driver = { ...recording().driver, list: () => { throw new Error('boom'); } } as Driver;
    expect(await servicesMethods(machine, driver)['x-ahpd/services/list']!.handle({}, undefined, 'c1'))
      .toEqual({ ok: false, code: 'DRIVER_FAILED', message: 'services driver failed: boom' });
  });
});

describe('showDrift', () => {
  it('raises a new or changed alert once, and clears one that went', () => {
    const said: Array<DriftAlert | string> = [];
    const host = { alert: (one: DriftAlert) => { said.push(one); }, clearAlert: (ref: string) => { said.push(`clear ${ref}`); } };
    const a = { level: 'warning' as const, ref: 'services-drift:a', text: 'a' };
    const b = { level: 'warning' as const, ref: 'services-drift:b', text: 'b' };
    let raised = showDrift(host, new Map(), [a, b]);
    raised = showDrift(host, raised, [a, { ...b, text: 'b2' }]);
    showDrift(host, raised, [a]);
    expect(said).toEqual([a, b, { ...b, text: 'b2' }, 'clear services-drift:b']);
  });
});

describe('apply', () => {
  let dir: string;
  let server: Server;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ahpd-services-plugin-'));
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n');
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ name: 'other', status: 'Running' }] }));
    });
    await new Promise<void>((done) => server.listen(join(dir, 'pc.sock'), done));
  });
  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });

  const host = () => {
    const methods = new Map<string, ServicesMethod>();
    const alerts: DriftAlert[] = [];
    const grants: Array<[string, string[]]> = [];
    const closers: Array<() => void | Promise<void>> = [];
    const served: ServicesHost = {
      configDir: dir,
      registerMethod: (name, method) => { methods.set(name, method); },
      registerGrants: (subject, entry) => { grants.push([subject, entry.operations]); },
      registerClose: (close) => { closers.push(close); },
      alert: (one) => { alerts.push(one); },
      clearAlert: () => {},
    };
    return { served, methods, alerts, grants, closers };
  };

  it('registers the methods and grants, and checks drift at once', async () => {
    const made = host();
    apply(made.served, { files: [join(dir, 'local.yaml')], socket: join(dir, 'pc.sock'), machine: 'test-machine' });
    expect([...made.methods.keys()]).toEqual(METHODS);
    expect(made.grants).toEqual([['services', ['list', 'get', 'put', 'delete', 'control']]]);
    for (let i = 0; i < 50 && made.alerts.length < 2; i += 1) await new Promise((done) => setTimeout(done, 20));
    expect(made.alerts.map((one) => one.ref)).toEqual(['services-drift:not-loaded:web', 'services-drift:not-in-files:other']);
    for (const close of made.closers) await close();
  });

  it('says on the plugin\'s page which option is wrong, and every method answers it', async () => {
    const made = host();
    apply(made.served, { files: ['relative.yaml'], socket: join(dir, 'pc.sock') });
    expect(made.alerts).toEqual([{ level: 'error', ref: 'services-options', text: expect.stringContaining('"files" must list') }]);
    expect([...made.methods.keys()]).toEqual(METHODS);
    expect(await made.methods.get('x-ahpd/services/list')!.handle({}, undefined, 'c1'))
      .toMatchObject({ ok: false, code: 'NOT_CONFIGURED', message: expect.stringContaining('"files" must list') });
  });
});
