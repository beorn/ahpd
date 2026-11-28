import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { invokeOperation, pluginOperationChannels } from '../../sdk/src/kinds/operations.js';
import type { PluginChannel, PluginHost, PluginMethod } from '../../sdk/src/types/plugin.js';
import type { ResourceProvider } from '../../sdk/src/types/resources.js';
import type { Principal } from '../../sdk/src/types/users.js';
import {
  BACKUP, CHANGED, CHANGES, CHANNEL, GRANT_WORDS, OPERATIONS, READS_SCHEME, SCHEME, SERVICE_SCHEME,
  type ServiceRow, type ServicesChannel, type ServicesProvider, type ServicesState,
} from '../src/channel.js';
import { listServices } from '../src/compose.js';
import type { DriftAlert } from '../src/drift.js';
import { GAVE_UP_REF } from '../src/watch.js';
import {
  REPLACED_IN, RETIRED, UNREADABLE_REF, apply, callerOf, showDrift,
  type ServicesChannelHandle, type ServicesHost, type ServicesMethod,
} from '../src/plugin.js';

/*
 * #38277: the services driver as the x-hh-services:// channel (ADR-004
 * amendment 6). The machine is real (a -f file and a change log in a temporary
 * directory), process-compose is a fake on a Unix socket, and an operation runs
 * through the SDK's own invokeOperation, as a client's call does.
 */

// What the daemon hands a plugin has what this plugin reads, and what it registers is what the daemon takes:
// checked by the compiler, not at run time.
const _host = (host: PluginHost): ServicesHost => host;
const _method = (method: ServicesMethod): PluginMethod => method;
const _channel = (channel: ServicesChannel): PluginChannel => channel as unknown as PluginChannel;
const _provider = (provider: ServicesProvider): ResourceProvider => provider;
const _handle = (handle: ReturnType<PluginHost['registerChannel']>): ServicesChannelHandle => handle;
void _host; void _method; void _channel; void _provider; void _handle;

/** A caller holding exactly these grants. */
const holding = (grants: string[]): Principal => ({ id: 'ana', roles: [], can: (grant: string) => grants.includes(grant) });

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((done) => setTimeout(done, 20));
  expect(check()).toBe(true);
};

let dir: string;
let server: Server;
let processStates: WebSocketServer;
let streamToken: string | string[] | undefined;
let pcSeen: string[];
let pcProcesses: Array<Record<string, unknown>>;
let stopResponse: ((response: ServerResponse) => void) | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-services-channel-'));
  writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ machine: { allowRemoteCommands: true } }));
  pcSeen = [];
  pcProcesses = [{ name: 'web', status: 'Running' }, { name: 'other', status: 'Running' }];
  stopResponse = undefined;
  processStates = new WebSocketServer({ noServer: true });
  streamToken = undefined;
  server = createServer((request, response) => {
    pcSeen.push(`${request.method} ${request.url}`);
    const json = (body: unknown): void => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body)); };
    if (request.url === '/processes') json({ data: pcProcesses });
    else if (request.method === 'PATCH' && request.url === '/process/stop/web' && stopResponse !== undefined) stopResponse(response);
    else if (request.url?.startsWith('/process/logs/')) json({ logs: ['listening on 8080', 'ready'] });
    else json({});
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/process/states/ws') {
      socket.destroy();
      return;
    }
    streamToken = request.headers['x-pc-token-key'];
    processStates.handleUpgrade(request, socket, head, () => {});
  });
  await new Promise<void>((done) => server.listen(join(dir, 'pc.sock'), done));
});

afterEach(async () => {
  for (const client of processStates.clients) client.terminate();
  processStates.close();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

/** A host that keeps what the plugin registers. */
const host = () => {
  const methods = new Map<string, ServicesMethod>();
  const providers = new Map<string, ServicesProvider>();
  const alerts: DriftAlert[] = [];
  const grants: Array<[string, string[]]> = [];
  const closers: Array<() => void | Promise<void>> = [];
  const cleared: string[] = [];
  const published: Array<{ uri: string; action: { type: string } & Record<string, unknown> }> = [];
  let channel: ServicesChannel | undefined;
  let subscribed = true;
  const served: ServicesHost = {
    configDir: dir,
    registerMethod: (name, method) => { methods.set(name, method); },
    registerGrants: (subject, entry) => { grants.push([subject, entry.operations]); },
    registerChannel: (_scheme, registered) => {
      channel = registered;
      return { publish: (uri, action) => { published.push({ uri, action }); }, subscribers: () => (subscribed ? [{ client: 'c1' }] : []) };
    },
    registerResourceProvider: (scheme, provider) => { providers.set(scheme, provider); },
    registerClose: (close) => { closers.push(close); },
    alert: (one) => { alerts.push(one); },
    clearAlert: (ref) => { cleared.push(ref); },
  };
  const made = {
    served, methods, providers, alerts, grants, closers, cleared, published,
    channel: () => channel!,
    unsubscribe: () => { subscribed = false; },
    snapshot: () => channel!.snapshot(CHANNEL) as ServicesState,
    /** The SDK's own command over this plugin's channel. */
    invoke: () => invokeOperation({ channels: () => pluginOperationChannels({ [SCHEME]: { by: 'services', channel: channel as unknown as PluginChannel } }), check: () => {} }),
    close: async () => { for (const close of closers) await close(); },
  };
  return made;
};

const options = (extra: Record<string, unknown> = {}) => ({ files: [join(dir, 'local.yaml')], socket: join(dir, 'pc.sock'), machine: 'test-machine', ...extra });
const ifVersion = (): string => {
  const listing = listServices({ name: 'test-machine', configDir: dir, changeLog: join(dir, 'services', 'changes.jsonl'), backend: { kind: 'process-compose', files: [join(dir, 'local.yaml')], pc: { socket: join(dir, 'pc.sock') } } });
  if (!listing.ok) throw new Error(listing.message);
  return listing.ifVersion;
};
const logLines = (): Array<Record<string, unknown>> =>
  readFileSync(join(dir, 'services', 'changes.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
const pushProcessState = (row: Record<string, unknown>): void => {
  for (const client of processStates.clients) client.send(JSON.stringify({ state: row }));
};

describe('apply', () => {
  it('checks retry exhaustion as soon as Process Compose reports completion, and holds it while the program runs again', async () => {
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n    availability:\n      restart: on_failure\n      max_restarts: 1\n');
    const tokenFile = join(dir, 'pc.token');
    writeFileSync(tokenFile, 'fixture-process-compose-token\n');
    const made = host();
    apply(made.served, options({ tokenFile }));
    try {
      await until(() => made.snapshot().rows[0]?.state.status === 'Running');
      await until(() => processStates.clients.size === 1);
      expect(streamToken).toBe('fixture-process-compose-token');
      const completed = { name: 'web', status: 'Completed', exit_code: 17, restarts: 1 };
      pcProcesses[0] = completed;
      pushProcessState(completed);
      await until(() => made.alerts.some((alert) => alert.ref === `${GAVE_UP_REF}web`));
      expect(made.snapshot().rows[0]).toMatchObject({ state: { status: 'Completed' }, alerts: [{ ref: `${GAVE_UP_REF}web` }] });

      const before = made.published.length;
      pushProcessState(completed);
      await until(() => made.published.length > before);
      expect(made.alerts.filter((alert) => alert.ref === `${GAVE_UP_REF}web`)).toHaveLength(1);

      // #39156 C (@cto 726f1c98): a re-run in flight must not read as recovery. Running with a bare zero keeps
      // the gave-up alert; only a later terminal success clears it.
      pcProcesses[0] = { name: 'web', status: 'Running', exit_code: 0, restarts: 0 };
      pushProcessState(pcProcesses[0]);
      await new Promise((done) => setTimeout(done, 300));
      expect(made.cleared).not.toContain(`${GAVE_UP_REF}web`);
      expect(made.alerts.filter((alert) => alert.ref === `${GAVE_UP_REF}web`)).toHaveLength(1);
      // The next terminal success is what clears it.
      pcProcesses[0] = { name: 'web', status: 'Completed', exit_code: 0, restarts: 0 };
      pushProcessState(pcProcesses[0]);
      await until(() => made.cleared.includes(`${GAVE_UP_REF}web`));
    }
    finally { await made.close(); }
  });

  it('reports a lost Process Compose stream and reconnects before the next drift check', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const made = host();
    apply(made.served, options());
    const ref = 'services-drift:process-states';
    try {
      await until(() => processStates.clients.size === 1);
      for (const client of processStates.clients) client.terminate();
      await until(() => made.alerts.some((alert) => alert.ref === ref && alert.text.includes('pc.sock')));
      await vi.advanceTimersByTimeAsync(60_000);
      await until(() => processStates.clients.size === 1 && made.cleared.includes(ref));
    }
    finally {
      await made.close();
      vi.useRealTimers();
    }
  });

  it('registers the service grants, the channel, both resource schemes and the nine old names, and checks drift at once', async () => {
    const made = host();
    apply(made.served, options());
    expect(made.grants).toEqual([['service', [...GRANT_WORDS]]]);
    expect([...made.methods.keys()]).toEqual(Object.keys(RETIRED));
    expect([...made.providers.keys()]).toEqual([SERVICE_SCHEME, READS_SCHEME]);
    expect(made.channel().grant).toBe('service:watch');
    await until(() => made.alerts.length > 0);
    expect(made.alerts.map((one) => one.ref)).toEqual(['services-drift:not-in-files:other']);
    const state = made.snapshot();
    expect(state.rows.map((row: ServiceRow) => [row.name, row.inFiles, row.state.status, row.alerts.map((one) => one.ref)])).toEqual([
      ['web', true, 'Running', []],
      ['other', false, 'Running', ['services-drift:not-in-files:other']],
    ]);
    expect(state.rows[0]!.record).toMatchObject({ name: 'web', command: 'sleep 2' });
    expect(state.alerts).toEqual([]);
    expect(state.operations.map((one) => [one.id, one.grant, one.scopes])).toEqual([
      ['put', 'service:put', ['list']], ['remove', 'service:remove', ['service']], ['start', 'service:start', ['service']],
      ['stop', 'service:stop', ['service']], ['restart', 'service:restart', ['service']], ['accept', 'service:accept', ['list']],
    ]);
    expect(made.published.at(-1)).toEqual({ uri: CHANNEL, action: { type: CHANGED, state } });
    await made.close();
  });

  it('says on the plugin\'s page which option is wrong, shows it in the snapshot, and refuses every operation with it', async () => {
    const made = host();
    apply(made.served, options({ files: ['relative.yaml'] }));
    expect(made.alerts).toEqual([{ level: 'error', ref: 'services-options', text: expect.stringContaining('"files" must list') }]);
    expect([...made.methods.keys()]).toEqual(Object.keys(RETIRED));
    expect(made.snapshot()).toMatchObject({ rows: [], operations: [], error: expect.stringContaining('"files" must list') });
    await expect(made.channel().operations.run({ id: 'restart' }, 'web', undefined, undefined))
      .rejects.toMatchObject({ name: 'RpcError', code: -32602, data: { code: 'NOT_CONFIGURED' } });
  });
});

describe('the operations, through invokeOperation', () => {
  it('runs a put under service:put, logging the owner the host resolved and never one planted in the input', async () => {
    const made = host();
    apply(made.served, options());
    const params = { channel: CHANNEL, operationId: 'put', input: { service: { name: 'api', command: 'serve --port 8080' }, ifVersion: ifVersion(), owner: 'user:mallory' } };
    await expect(made.invoke().handle(params, holding(['service:watch']), 'pipe-1', 'user:ana')).rejects.toThrow('service:put');
    expect(readFileSync(join(dir, 'local.yaml'), 'utf8')).not.toContain('api');

    const answer = await made.invoke().handle(params, holding(['service:put']), 'pipe-1', 'user:ana');
    expect(answer).toMatchObject({ changed: true, file: join(dir, 'local.yaml'), service: { name: 'api' } });
    expect(answer).not.toHaveProperty('ok');
    expect(readFileSync(join(dir, 'local.yaml'), 'utf8')).toContain('serve --port 8080');
    expect(logLines().at(-1)).toMatchObject({ op: 'put', name: 'api', principal: 'user:ana' });
    expect(JSON.stringify(logLines())).not.toContain('mallory');
    await made.close();
  });

  it('runs start, stop and restart on the service named as the target, under their own grants', async () => {
    const made = host();
    apply(made.served, options());
    for (const verb of ['start', 'stop', 'restart']) {
      await made.invoke().handle({ channel: CHANNEL, operationId: verb, target: { id: 'web' } }, holding([`service:${verb}`]), 'pipe-1', 'user:ana');
    }
    expect(pcSeen.filter((one) => one.includes('/process/'))).toEqual(['POST /process/start/web', 'PATCH /process/stop/web', 'POST /process/restart/web']);
    await made.close();
  });

  it.each([['Running', -1], ['Restarting', 19]])('stays quiet when a managed stop ends a %s service at its restart limit', async (status, exitCode) => {
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n    availability:\n      restart: on_failure\n      max_restarts: 1\n  other:\n    command: sleep 2\n');
    const started = new Date(Date.now() - 10_000).toISOString();
    pcProcesses = [{ name: 'web', status, exit_code: 19, restarts: 1, process_start_time: started }, { name: 'other', status: 'Running' }];
    let acknowledgeStop: (() => void) | undefined;
    stopResponse = (response) => {
      pcProcesses[0] = { name: 'web', status: 'Completed', exit_code: exitCode, restarts: 1, process_start_time: started, process_end_time: new Date().toISOString() };
      pushProcessState(pcProcesses[0]);
      acknowledgeStop = () => {
        acknowledgeStop = undefined;
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      };
    };
    const made = host();
    apply(made.served, options());
    const control = (verb: string, name: string) => made.invoke().handle(
      { channel: CHANNEL, operationId: verb, target: { id: name } }, holding([`service:${verb}`]), 'pipe-1', 'user:ana',
    );
    const webStatus = (current: ReturnType<typeof host>) => current.snapshot().rows.find((row) => row.name === 'web')?.state.status;
    let stop: ReturnType<typeof control> | undefined;
    try {
      await until(() => webStatus(made) === status);
      await until(() => processStates.clients.size === 1);
      stop = control('stop', 'web');
      await until(() => acknowledgeStop !== undefined);
      await until(() => webStatus(made) === 'Completed');
      expect(made.alerts.map((one) => one.ref)).not.toContain(`${GAVE_UP_REF}web`);
      const published = made.published.length;
      acknowledgeStop!();
      await stop;
      await until(() => made.published.length > published);
      expect(logLines().at(-1)).toMatchObject({ op: 'stop', name: 'web', principal: 'user:ana' });
      expect(made.alerts.map((one) => one.ref)).not.toContain(`${GAVE_UP_REF}web`);

      const restartedHost = host();
      apply(restartedHost.served, options());
      try {
        await until(() => webStatus(restartedHost) === 'Completed');
        expect(restartedHost.alerts.map((one) => one.ref)).not.toContain(`${GAVE_UP_REF}web`);
      }
      finally { await restartedHost.close(); }

      // A later native start has a new start time and does not write to the driver's journal.
      pcProcesses[0] = { ...pcProcesses[0], exit_code: -1, process_start_time: new Date().toISOString(), process_end_time: new Date().toISOString() };
      await control('start', 'other');
      await until(() => made.alerts.some((one) => one.ref === `${GAVE_UP_REF}web`));
    }
    finally {
      acknowledgeStop?.();
      try { await stop; }
      finally { await made.close(); }
    }
  });

  it('answers a driver refusal as an RpcError carrying its code and difference, and records no write', async () => {
    const made = host();
    apply(made.served, options());
    const stale = { channel: CHANNEL, operationId: 'put', input: { service: { name: 'web', cwd: '/srv' }, ifVersion: 'f'.repeat(64) } };
    await expect(made.invoke().handle(stale, holding(['service:put']), 'pipe-1', 'user:ana'))
      .rejects.toMatchObject({ code: -32602, data: { code: 'STALE_VERSION' } });
    expect(readFileSync(join(dir, 'local.yaml'), 'utf8')).not.toContain('/srv');
    await made.close();
  });

  it('offers remove only on a service the driver can edit, and start, stop and restart on any it shows', async () => {
    const made = host();
    apply(made.served, options());
    await until(() => made.alerts.length > 0);
    const { offers } = made.channel().operations;
    expect([offers('web', 'remove'), offers('other', 'remove'), offers('other', 'restart'), offers('nowhere', 'start')]).toEqual([true, false, true, false]);
    await expect(made.invoke().handle({ channel: CHANNEL, operationId: 'remove', target: { id: 'other' }, input: { ifVersion: ifVersion() } }, undefined, 'c1'))
      .rejects.toThrow('remove is not offered on other now');
    await made.close();
  });

  it('checks drift again after an operation and sends the new snapshot, but only while someone is subscribed', async () => {
    const made = host();
    apply(made.served, options());
    await until(() => made.published.length === 1);
    await made.invoke().handle({ channel: CHANNEL, operationId: 'restart', target: { id: 'web' } }, undefined, 'c1');
    await until(() => made.published.length === 2);
    made.unsubscribe();
    await made.invoke().handle({ channel: CHANNEL, operationId: 'restart', target: { id: 'web' } }, undefined, 'c1');
    await new Promise((done) => setTimeout(done, 100));
    expect(made.published).toHaveLength(2);
    expect(made.alerts.filter((one) => one.ref.endsWith('publish'))).toEqual([]);
    await made.close();
  });
});

describe('the resources', () => {
  it('reads a service\'s raw output at hh-service://<name>/logs under service:logs, which service:watch does not give', async () => {
    const made = host();
    apply(made.served, options());
    const logs = made.providers.get(SERVICE_SCHEME)!;
    const uri = 'hh-service://web/logs?limit=5&endOffset=2';
    expect(await logs.authorize(uri, holding(['service:logs']))).toBe(true);
    expect(await logs.authorize(uri, holding(['service:watch']))).toBe(false);
    expect(await logs.authorize(uri, undefined)).toBe(false);
    expect(await logs.authorize('hh-service://web', holding(['service:logs']))).toBe(false);
    const read = await logs.read(uri, undefined, holding(['service:logs']));
    expect(JSON.parse(read.data)).toEqual({ label: 'raw output from web on test-machine', name: 'web', lines: ['listening on 8080', 'ready'] });
    expect(pcSeen).toContain('GET /process/logs/web/2/5');
    await expect(logs.read('hh-service://web/config')).rejects.toMatchObject({ name: 'RpcError', code: -32602 });
    await made.close();
  });

  it('reads the listing at hh-services://backup and the change log at hh-services://changes by byte range, under service:watch', async () => {
    const made = host();
    apply(made.served, options());
    const backup = made.providers.get(READS_SCHEME)!;
    expect(await backup.authorize(BACKUP, holding(['service:watch']))).toBe(true);
    expect(await backup.authorize(CHANGES, holding(['service:watch']))).toBe(true);
    expect(await backup.authorize(CHANGES, holding(['service:logs']))).toBe(false);
    expect(JSON.parse((await backup.read(BACKUP)).data)).toMatchObject({ services: [{ name: 'web' }], file: join(dir, 'local.yaml') });

    appendFileSync(join(dir, 'services', 'changes.jsonl'), '{"op":"one"}\n{"op":"two"}\n');
    const first = JSON.parse((await backup.readRange!(CHANGES, undefined, { position: 0, length: 15 })).data) as { log: string; end: number; lines: unknown[] };
    expect([first.lines, first.end]).toEqual([[{ op: 'one' }], 13]);
    const next = JSON.parse((await backup.readRange!(`${CHANGES}?log=${encodeURIComponent(first.log)}`, undefined, { position: first.end })).data) as { lines: unknown[] };
    expect(next.lines).toEqual([{ op: 'two' }]);
    await expect(backup.readRange!(`${CHANGES}?log=1:2:3`, undefined, { position: 0 }))
      .rejects.toMatchObject({ name: 'RpcError', code: -32602, data: { code: 'CHANGES_REPLACED' } });
    await expect(backup.read('hh-services://elsewhere')).rejects.toMatchObject({ code: -32602 });
    await made.close();
  });

  it('raises one alert for an unreadable change-log line a read met, and clears it once the log is replaced', async () => {
    const made = host();
    const log = join(dir, 'changes.jsonl');
    apply(made.served, options({ changeLog: log }));
    writeFileSync(log, '{"op":"ok"}\nhalf-writ\n');
    await made.providers.get(READS_SCHEME)!.read(CHANGES);
    expect(made.alerts.filter((one) => one.ref === UNREADABLE_REF))
      .toEqual([{ level: 'warning', ref: UNREADABLE_REF, text: `services change log has an unreadable line at 12 (${log})` }]);
    rmSync(log);
    writeFileSync(log, '{"op":"ok"}\n');
    // An operation runs the drift check at once; the check clears the alert for a replaced log.
    await made.invoke().handle({ channel: CHANNEL, operationId: 'restart', target: { id: 'web' } }, undefined, 'c1');
    await until(() => made.cleared.includes(UNREADABLE_REF));
    await made.close();
  });
});

describe('the nine old methods', () => {
  it('refuse, naming what replaced each and in which release, to any caller, never a bare method-not-found', async () => {
    const made = host();
    apply(made.served, options());
    const list = made.methods.get('x-ahpd/services/list')!;
    expect(await list.authorize!({}, { id: 'old-cli' })).toBe(true);
    await expect(list.handle({}, undefined, 'c1')).rejects.toMatchObject({
      name: 'RpcError',
      code: -32601,
      message: `x-ahpd/services/list was replaced by a subscribe to x-hh-services:// in ${REPLACED_IN}; update the caller (the Hightea CLI and gateway) to a release that uses it`,
    });
    await expect(made.methods.get('x-ahpd/services/backup')!.handle({}, undefined, 'c1'))
      .rejects.toThrow(`resourceReads of hh-services://backup and hh-services://changes in ${REPLACED_IN}`);
    await made.close();
  });
});

describe('who and drift', () => {
  it('names the caller by owner, then person, then client id, and never as local', () => {
    expect(callerOf({ id: 'bjorn' }, 'c1', 'root:host')).toEqual({ principal: 'root:host', remote: true });
    expect(callerOf({ id: 'bjorn' }, 'c1', undefined)).toEqual({ principal: 'user:bjorn', remote: true });
    expect(callerOf(undefined, 'vscode-1', undefined)).toEqual({ principal: 'client:vscode-1', remote: true });
  });

  it('raises a new or changed alert once, and clears one that went', () => {
    const said: Array<DriftAlert | string> = [];
    const alerting = { alert: (one: DriftAlert) => { said.push(one); }, clearAlert: (ref: string) => { said.push(`clear ${ref}`); } };
    const a = { level: 'warning' as const, ref: 'services-drift:a', text: 'a' };
    const b = { level: 'warning' as const, ref: 'services-drift:b', text: 'b' };
    let raised = showDrift(alerting, new Map(), [a, b]);
    raised = showDrift(alerting, raised, [a, { ...b, text: 'b2' }]);
    showDrift(alerting, raised, [a]);
    expect(said).toEqual([a, b, { ...b, text: 'b2' }, 'clear services-drift:b']);
  });

  it('lists every operation the snapshot offers', () => {
    expect(OPERATIONS.map((one) => one.id)).toEqual(['put', 'remove', 'start', 'stop', 'restart', 'accept']);
  });
});
