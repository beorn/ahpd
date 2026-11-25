import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
import type { Agent, Start } from '../src/types/agent.js';
import type { Session } from '../src/types/session.js';
import type { Connection } from '../src/types/host.js';
import { heldToGrants } from '../src/host/gate.js';
import { ROOT } from '../src/host/channels.js';
import { WAIT_MS } from '../../../tools/wait.ts';

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
    let seen: { id: string | undefined; plugin: string | undefined; frozen: boolean } | undefined;
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

/*
 * #38446 follow-up: every other grant check a host with no directory skipped.
 * Each case below is a plugin's own connection on a host with no user
 * directory - refused or shown nothing without the one grant its site asks
 * for, let through with it - and the root connection on the same host, which
 * stays trusted.
 */

/** A plugin's own principal, frozen as `host.connect()` serves it (asserted above). */
const pluginPrincipal = (grants: Grant[], name = 'pipe'): Principal => Object.freeze({
  id: `plugin:${name}`, plugin: name, roles: Object.freeze([]), grants: Object.freeze([...grants]),
  can: (grant: Grant) => holds(new Set(grants), grant),
});

/** Let dispatches and the writes behind them come to. */
const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** Yield until `ready` says so, failing loudly with `what` when it never does. */
const waitFor = async (ready: () => boolean, what: string): Promise<void> => {
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    if (ready()) return;
    await new Promise((done) => { setTimeout(done, 5); });
  }
  throw new Error(`${what} never happened in ${WAIT_MS} ms`);
};

type Client = ReturnType<ReturnType<typeof gateHost>['accept']>;

/** The rejection reasons a watching peer was sent. */
const rejections = (seen: ReturnType<typeof watching>): string[] => seen.seen
  .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
  .map((one) => String(one.params.rejectionReason));

describe('heldToGrants', () => {
  it('holds a plugin to its grants with or without a directory, and nobody else on a host with none', () => {
    const plugin = { principal: pluginPrincipal([]) } as unknown as Connection;
    const person = { principal: { id: 'ana', roles: [], can: () => false } } as unknown as Connection;
    const rootConnection = { root: true, principal: pluginPrincipal([]) } as unknown as Connection;
    expect(heldToGrants(rootConnection, true)).toBe(false);
    expect(heldToGrants(rootConnection, false)).toBe(false);
    expect(heldToGrants(person, true)).toBe(true);
    expect(heldToGrants(plugin, true)).toBe(true);
    expect(heldToGrants(plugin, false)).toBe(true);
    expect(heldToGrants(person, false)).toBe(false);
    expect(heldToGrants({} as Connection, false)).toBe(false);
    expect(heldToGrants(undefined, false)).toBe(false);
    expect(heldToGrants(undefined, true)).toBe(true);
  });
});

/*
 * Allow All in a permission answer turns on the session's autoApprove, a change
 * of the session's config: `session:configure` (chatactions.ts).
 */
describe('Allow All with no user directory', () => {
  /** The echo backend asking about one bash call per turn, keeping every answer. */
  const asking = (answers: [string, boolean, string | undefined][]): Agent => {
    const base = echo({ path: DIR, pace: 50 });
    return {
      ...base,
      provider: 'asking',
      create: (start: Start): Session => {
        const session = base.create(start) as Session;
        return {
          ...session,
          sendMessage: (...args: Parameters<Session['sendMessage']>) => {
            void session.sendMessage(...args);
            const turnId = args[0];
            start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: `call-${turnId}`, toolName: 'bash', displayName: 'Bash' });
            start.emit('chat', {
              type: 'chat/toolCallReady', turnId, toolCallId: `call-${turnId}`, invocationMessage: 'Run make', toolInput: 'make build', confirmationTitle: 'Run Bash?',
              permissionKind: 'shell', shellCommand: 'make build', shellLanguage: 'bash',
            });
          },
          confirm: (toolCallId: string, approved: boolean, optionId?: string) => { answers.push([toolCallId, approved, optionId]); return true; },
        };
      },
    };
  };

  /** A host with a question pending in a session's chat, and who answers it: the plugin with `grants`, or root. */
  const answering = async (who: Grant[] | 'root') => {
    const answers: [string, boolean, string | undefined][] = [];
    const made = gateHost({ agents: [asking(answers)] });
    const owner = watching();
    const rootClient = made.accept(owner, undefined, true);
    await hello(rootClient, 'root');
    expect(await call(rootClient, 'createSession', { channel: 'asking:/one', provider: 'asking' })).toHaveProperty('result');
    const opened = await call(rootClient, 'subscribe', { channel: 'asking:/one' }) as { result: { snapshot: { state: { defaultChat: string } } } };
    const chat = opened.result.snapshot.state.defaultChat;
    await call(rootClient, 'subscribe', { channel: chat });
    await rootClient.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } } } });
    await waitFor(() => owner.seen.some((one) => one.method === 'action' && one.params.action?.type === 'chat/toolCallReady'), 'the question');
    await settle();
    const seen = watching();
    const answerer = who === 'root' ? rootClient : made.accept(seen, pluginPrincipal(who));
    if (who !== 'root') await hello(answerer, 'pipe');
    await answerer.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-t1', approved: true, confirmed: 'user-action', selectedOptionId: 'allow-all-session' } } });
    await settle();
    const autoApproved = owner.seen.some((one) => one.method === 'action' && one.params.action?.type === 'session/configChanged'
      && (one.params.action.config as Record<string, unknown>)?.autoApprove === 'autoApprove');
    return { answers, refused: rejections(seen), autoApproved };
  };

  it('refuses a plugin peer without session:configure, and the call keeps asking', async () => {
    const got = await answering(['chat:answer']);
    expect(got.refused).toEqual(['plugin:pipe may not session:configure here']);
    expect(got.answers).toEqual([]);
    expect(got.autoApproved).toBe(false);
  });

  it('takes Allow All from a plugin peer holding session:configure, and from root', async () => {
    for (const who of [['chat:answer', 'session:configure'] as Grant[], 'root' as const]) {
      const got = await answering(who);
      expect(got.refused).toEqual([]);
      expect(got.answers).toEqual([['call-t1', true, 'allow-all-session']]);
      expect(got.autoApproved).toBe(true);
    }
  });
});

/*
 * A session placed on a computer its agent names as a source is a machine made
 * for whoever asked: `computer:write` (sessionmethods.ts).
 */
describe('a session placed on a computer with no user directory', () => {
  const placing = (): Agent => ({ ...echo({ path: DIR, pace: 0 }), provider: 'placed', placeSession: () => ({ computer: 'disposable:s' }) });

  it('refuses a plugin peer without computer:write, and lets one holding it and root past that question', async () => {
    const made = gateHost({ agents: [placing()] });
    const without = made.accept(watching(), pluginPrincipal(['session:*']));
    await hello(without, 'pipe');
    expect(await call(without, 'createSession', { channel: 'placed:/one', provider: 'placed' }))
      .toMatchObject({ code: -32009, message: 'plugin:pipe may not computer:write here' });

    // Past the question, what stops the start names the machine, not the person.
    const holding = made.accept(watching(), pluginPrincipal(['session:*', 'computer:*']));
    await hello(holding, 'pipe');
    const granted = await call(holding, 'createSession', { channel: 'placed:/two', provider: 'placed' }) as { message?: string };
    expect(granted.message).toContain('this host has no computer plugin that makes a machine from it');
    expect(granted.message).not.toContain('computer:write');

    const rootClient = made.accept(watching(), undefined, true);
    await hello(rootClient, 'root');
    const asRoot = await call(rootClient, 'createSession', { channel: 'placed:/three', provider: 'placed' }) as { message?: string };
    expect(asRoot.message).toContain('this host has no computer plugin that makes a machine from it');
  });
});

/*
 * The daemon's own root config keys need `config:settings`, and the account an
 * agent bills to needs `account:status` (gate.ts seesConfig / seesAccount).
 */
describe('the root config with no user directory', () => {
  const SIGNED_IN = { status: 'signedIn', email: 'ana@example.test', planType: 'max', observedAt: 1_700_000_000_000 } as const;

  const configured = () => gateHost({
    agents: [{ ...echo({ path: DIR, pace: 0 }), provider: 'claude', probe: async () => ({ models: [], commands: [], customizations: [], account: SIGNED_IN }) }],
    rootConfig: {
      schema: () => ({ type: 'object', properties: { 'ahpd.port': { type: 'number', title: 'Port' } } }),
      values: async () => ({ 'ahpd.port': 7600 }),
      write: async () => ({}),
    },
  });

  /** What one connection reads of the root config's values. */
  const valuesFor = async (made: ReturnType<typeof configured>, who: Grant[] | 'root'): Promise<Record<string, unknown>> => {
    const client: Client = who === 'root' ? made.accept(watching(), undefined, true) : made.accept(watching(), pluginPrincipal(who));
    await hello(client, who === 'root' ? 'root' : 'pipe');
    await settle();
    const opened = await call(client, 'subscribe', { channel: ROOT }) as { result?: { snapshot: { state: { config: { values: Record<string, unknown> } } } } };
    expect(opened).toHaveProperty('result');
    return opened.result!.snapshot.state.config.values;
  };

  it('shows a plugin peer neither the daemon\'s keys nor the account without the grants, and each with its own', async () => {
    const made = configured();
    const none = await valuesFor(made, []);
    expect(none).not.toHaveProperty('ahpd.port');
    expect(none).not.toHaveProperty('ahpd.claudeAccount');

    const settings = await valuesFor(made, ['config:settings']);
    expect(settings['ahpd.port']).toBe(7600);
    expect(settings).not.toHaveProperty('ahpd.claudeAccount');

    const account = await valuesFor(made, ['account:status']);
    expect(account['ahpd.claudeAccount']).toEqual(SIGNED_IN);
    expect(account).not.toHaveProperty('ahpd.port');

    const asRoot = await valuesFor(made, 'root');
    expect(asRoot['ahpd.port']).toBe(7600);
    expect(asRoot['ahpd.claudeAccount']).toEqual(SIGNED_IN);
  });
});

/*
 * A chat attached to a message hands the model an excerpt of its transcript,
 * which needs `session:read` (lifecycle.ts mayRead).
 */
describe('a chat attached to a message with no user directory', () => {
  /** The echo backend, keeping what every message it was sent attached. */
  const recording = (sent: unknown[][]): Agent => {
    const base = echo({ path: DIR, pace: 0 });
    return {
      ...base,
      provider: 'base',
      create: (start: Start): Session => {
        const session = base.create(start) as Session;
        return {
          ...session,
          sendMessage: (...args: Parameters<Session['sendMessage']>) => {
            sent.push([...(args[3] ?? [])]);
            return session.sendMessage(...args);
          },
        };
      },
    };
  };

  /** A finished turn in one session's chat, and a message in another's attaching it, sent by `who`. */
  const attaching = async (who: Grant[] | 'root'): Promise<string> => {
    const sent: unknown[][] = [];
    const made = gateHost({ agents: [recording(sent)] });
    const owner = watching();
    const rootClient = made.accept(owner, undefined, true);
    await hello(rootClient, 'root');
    const chatOf = async (uri: string): Promise<string> => {
      expect(await call(rootClient, 'createSession', { channel: uri, provider: 'base' })).toHaveProperty('result');
      const opened = await call(rootClient, 'subscribe', { channel: uri }) as { result: { snapshot: { state: { defaultChat: string } } } };
      await call(rootClient, 'subscribe', { channel: opened.result.snapshot.state.defaultChat });
      return opened.result.snapshot.state.defaultChat;
    };
    const review = await chatOf('base:/review');
    const live = await chatOf('base:/live');
    await rootClient.handle({ method: 'dispatchAction', params: { channel: review, action: { type: 'chat/turnStarted', turnId: 'r1', startedAt: new Date().toISOString(), message: { text: 'a secret only a reader may see', origin: { kind: 'user' } } } } });
    await waitFor(() => owner.seen.some((one) => one.method === 'action' && one.params.channel === review && one.params.action?.type === 'chat/turnComplete'), 'the reviewed turn');
    const before = sent.length;
    const seen = watching();
    const sender = who === 'root' ? rootClient : made.accept(seen, pluginPrincipal(who));
    if (who !== 'root') await hello(sender, 'pipe');
    await sender.handle({ method: 'dispatchAction', params: { channel: live, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'see this', origin: { kind: 'user' }, attachments: [{ type: 'chat', resource: review, label: 'Review' }] } } } });
    await waitFor(() => sent.length > before, 'the message reaching the backend');
    expect(rejections(seen)).toEqual([]);
    return JSON.stringify(sent.at(-1));
  };

  it('leaves the excerpt off for a plugin peer without session:read, and hands it over with the grant and to root', async () => {
    const without = await attaching(['chat:send', 'chat:turns']);
    expect(without).toContain('The user referenced another chat');
    expect(without).not.toContain('a secret only a reader may see');

    expect(await attaching(['chat:send', 'chat:turns', 'session:read'])).toContain('a secret only a reader may see');
    expect(await attaching('root')).toContain('a secret only a reader may see');
  });
});
