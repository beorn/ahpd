import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loggerOf } from '../src/log.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { createPair } from '../src/utils/pair.js';
import { echo } from '../../../examples/echo/agent.js';
import { call, directory, hello, host as gateHost, root as gateRoot, until, watching } from './users-gate-helpers.js';
import { holds } from '../src/access/users.js';
import { shellTerminals } from '../src/machines/terminals.js';
import type { Principal } from '../src/types/users.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';

/*
 * #38446 (@cto 89be3ef1): a plugin's own connection is held to the grants its
 * entry names whether or not the host has a user directory. A Hightea-joined
 * host has none, and before this every plugin peer there was admitted to every
 * method: the Hightea pipe, granted session:write, session:state and
 * chat:turns, could list and restart the machine's services. A host with no
 * user directory still trusts its root connection - the person at the machine.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-plugin-grants-'));
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

type Answer = 'ADMITTED' | `REFUSED ${string}`;

/** A host serving `x-probe/read` (grant probe:read) and `x-probe/restart` (probe:control), and a caller plugin with `grants`. */
async function hosting(users: boolean, grants: Grant[]) {
  const ran: string[] = [];
  const probe = pluginHost('probe', context(), { grants: [] });
  probe.host.registerMethod('x-probe/read', { grant: 'probe:read', describe: () => ({ title: 'read' }), handle: async () => { ran.push('read'); return { ok: true }; } });
  probe.host.registerMethod('x-probe/restart', { grant: 'probe:control', describe: () => ({ title: 'restart' }), handle: async () => { ran.push('restart'); return { ok: true }; } });
  const caller = pluginHost('pipe', context(), { grants });
  const { options } = foldHostOptions({
    path: DIR,
    agents: [{ ...echo({ path: DIR, pace: 0 }), provider: 'base', displayName: 'Base' }],
    sessions: memorySessions(),
    ...(users ? { users: directory({}) } : {}),
  }, [probe.contribution, caller.contribution]);
  const host = createHost(options);
  for (const one of options.pluginConnects ?? []) one.host = host;
  const ask = async (connection: { request: (method: string, params: unknown) => Promise<unknown> }, method: string): Promise<Answer> =>
    connection.request(method, {}).then(() => 'ADMITTED' as const, (error: { code?: number; message: string }) => `REFUSED ${error.code ?? ''} ${error.message}` as const);
  const pluginPeer = caller.host.connect();
  await pluginPeer.request('initialize', { clientId: 'pipe', protocolVersions: ['0.9.0'] });
  const rootPair = createPair();
  rootPair.served(host.accept(rootPair.host, undefined, true));
  await rootPair.plugin.request('initialize', { clientId: 'root', protocolVersions: ['0.9.0'] });
  const plugin = { read: await ask(pluginPeer, 'x-probe/read'), restart: await ask(pluginPeer, 'x-probe/restart') };
  const ranForPlugin = [...ran];
  const root = { read: await ask(rootPair.plugin, 'x-probe/read'), restart: await ask(rootPair.plugin, 'x-probe/restart') };
  return { plugin, ranForPlugin, root, close: () => host.close() };
}

const PIPE: Grant[] = ['session:write', 'session:state', 'chat:turns'];

for (const users of [false, true]) {
  const mode = users ? 'with a user directory' : 'with no user directory (a Hightea-joined host)';

  it(`${mode}: a plugin peer without the method's grant is refused -32009 and the method never runs`, async () => {
    const got = await hosting(users, PIPE);
    expect(got.plugin.read).toMatch(/^REFUSED -32009 plugin:pipe may not probe:read/);
    expect(got.plugin.restart).toMatch(/^REFUSED -32009 plugin:pipe may not probe:control/);
    expect(got.ranForPlugin).toEqual([]);
    await got.close();
  });

  it(`${mode}: a plugin peer holding the grant is admitted, and holding read does not reach control`, async () => {
    const got = await hosting(users, [...PIPE, 'probe:read']);
    expect(got.plugin.read).toBe('ADMITTED');
    expect(got.ranForPlugin).toEqual(['read']);
    expect(got.plugin.restart).toMatch(/^REFUSED -32009 plugin:pipe may not probe:control/);
    await got.close();
  });
}

it('with no user directory the root connection is still trusted with everything, as documented', async () => {
  const got = await hosting(false, PIPE);
  expect(got.root).toEqual({ read: 'ADMITTED', restart: 'ADMITTED' });
  await got.close();
});

/*
 * Actions are gated apart from commands (actions.ts), and that gate had the
 * same no-directory shortcut: a plugin peer could type into a terminal.
 */
it('with no user directory a plugin peer without terminal:write cannot type into a terminal; root still can', async () => {
  const made = gateHost({ terminals: shellTerminals() });
  const owner = watching();
  const rootClient = made.accept(owner, undefined, true);
  await hello(rootClient, 'root');
  const uri = 'ahp-terminal:/plugin-grants';
  expect(await call(rootClient, 'createTerminal', { channel: uri, claim: { kind: 'client', clientId: 'root' }, cwd: `file://${gateRoot}` })).toHaveProperty('result');
  await call(rootClient, 'subscribe', { channel: uri });

  const grants: Grant[] = ['session:write', 'session:state', 'chat:turns'];
  const principal: Principal = Object.freeze({
    id: 'plugin:pipe', plugin: 'pipe', roles: Object.freeze([]), grants: Object.freeze([...grants]),
    can: (grant: Grant) => holds(new Set(grants), grant),
  });
  const quiet = watching();
  const pluginClient = made.accept(quiet, principal);
  await hello(pluginClient, 'pipe');
  pluginClient.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/input', data: 'echo PLUGIN-RAN-THIS\n' } } });
  rootClient.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/input', data: 'echo ROOT-RAN-THIS\n' } } });
  const after = await until(owner, uri, 'ROOT-RAN-THIS');
  expect(after).not.toContain('PLUGIN-RAN-THIS');
  const rejected = quiet.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string');
  expect(String(rejected[0]?.params.rejectionReason)).toMatch(/plugin:pipe may not terminal:/);
});

/*
 * The whole rule keys on `principal.plugin` (@cto 806f0ee5). The one path that
 * opens a plugin's connection is `host.connect()` (plugins.ts), which serves it
 * as the entry's frozen `plugin:<name>` principal; this drives that path and
 * reads back what a handler is given.
 */
it("a plugin's host.connect() connection always carries principal.plugin as the entry's name, with and without a user directory", async () => {
  for (const users of [false, true]) {
    let seen: { id?: string; plugin?: string; frozen: boolean } | undefined;
    const probe = pluginHost('probe', context(), { grants: [] });
    probe.host.registerMethod('x-probe/who', {
      grant: 'probe:read', describe: () => ({ title: 'who' }),
      handle: async (_params, reader) => { seen = { id: reader?.id, plugin: reader?.plugin, frozen: Object.isFrozen(reader) }; return { ok: true }; },
    });
    const caller = pluginHost('hightea-pipe', context(), { grants: ['probe:read'] });
    const { options } = foldHostOptions({
      path: DIR, agents: [{ ...echo({ path: DIR, pace: 0 }), provider: 'base', displayName: 'Base' }], sessions: memorySessions(),
      ...(users ? { users: directory({}) } : {}),
    }, [probe.contribution, caller.contribution]);
    const host = createHost(options);
    for (const one of options.pluginConnects ?? []) one.host = host;
    const connection = caller.host.connect();
    await connection.request('initialize', { clientId: 'hightea-pipe', protocolVersions: ['0.9.0'] });
    await connection.request('x-probe/who', {});
    expect(seen).toEqual({ id: 'plugin:hightea-pipe', plugin: 'hightea-pipe', frozen: true });
    await host.close();
  }
});
