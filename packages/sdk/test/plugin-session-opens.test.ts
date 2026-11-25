import { loggerOf } from '../src/log.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import {
  claude, createHost, machine, resetSdk, sdk,
} from './support/host.js';
import {
  directory, hello, peer, signIn,
} from './users-gate-helpers.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';
import { WORK } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * Whether a session opens.
 *
 * The store keeps what was recorded about a session - its owner, its chats -
 * and a row outlives the session itself: a process that ran no turn leaves
 * nothing on a backend's disk, so after a restart the row is all there is and
 * a subscribe to that URI answers `No agent for session`.
 *
 * `sessionOpens` is what a plugin handing a session back to a person asks,
 * so it answers `true` only where the host can open the session: running now,
 * or in its catalogue. `sessionKept` still answers the row, for a plugin that
 * asks what the store keeps.
 */

const DIR = WORK;

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/**
 * A plugin folded into a host the way the loader folds one.
 *
 * The host is real rather than stubbed: `sessionOpens` reads the live
 * catalogue through the contribution, so a version of this that skipped the
 * fold would be asking a store and nothing else.
 */
function owned(tokens: Record<string, Grant[]> = { soft: ['session:*'] }) {
  const sessions = memorySessions();
  // The store the host keeps is the one the plugin reads its rows from, as the
  // daemon wires it: one store, reached from both sides.
  const { host: plugin, contribution } = pluginHost('bots', context(), { sessions: () => sessions });
  const base: HostOptions = {
    path: DIR,
    agents: [claude({ paths: [DIR] })],
    ...machine(),
    sessions,
    users: directory(tokens),
  };
  const { options } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  return { plugin, host, sessions };
}

it('answers false for a session only the store remembers, which sessionKept still answers', async () => {
  const { plugin, sessions } = owned();
  // The row a restart leaves behind for a session that ran no turn: a config,
  // an owner and a provider, and nothing the host can open.
  sessions.setConfig('gone', {});
  sessions.setOwner('gone', 'user:soft');
  sessions.setProvider('gone', 'claude');

  expect(await plugin.sessionKept('claude:/gone')).toBe(true);
  expect(await plugin.sessionOpens('claude:/gone')).toBe(false);
});

it('answers true for a session this host is running', async () => {
  const { plugin, host } = owned();
  const client = host.accept(peer());
  await hello(client, 'soft');
  await signIn(client, 'soft');

  // A session a plugin started, with nobody speaking in it: the process runs.
  const uri = await plugin.startSession({ owner: 'user:soft' });

  expect(await plugin.sessionOpens(uri)).toBe(true);
});

it('answers true for a session on a backend\'s disk, under its own name only', async () => {
  const { plugin, sessions } = owned();
  // A transcript the backend wrote before this process started, and the row a
  // restart reads back for it.
  sdk.sessions.push({
    sessionId: 'kept', lastModified: Date.now(), cwd: DIR,
    createdAt: Date.now(), summary: 'Kept',
  });
  sessions.setConfig('kept', {});
  sessions.setOwner('kept', 'user:soft');
  sessions.setProvider('kept', 'claude');

  expect(await plugin.sessionOpens('claude:/kept')).toBe(true);
  expect(await plugin.sessionOpens('ahp-session:/kept')).toBe(false);
});

it('answers false for a session with no row at all', async () => {
  const { plugin } = owned();

  expect(await plugin.sessionOpens('claude:/nobody')).toBe(false);
});
