/*
 * `ahpd configure`, at a terminal nobody is sitting at and with npm faked.
 *
 * Every case is about the file the command leaves and the one npm call it makes:
 * the defaults it writes when every answer is Enter, what a second run shows for
 * them, and the keys and entries it was not asked about and kept anyway. The
 * terminal is faked so nothing here reads this process's own, and the runner is
 * a fake so no case needs a registry, a network or a package.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { terminal } from './answers.js';
import { installLine, knownAgents, type KnownAgent } from '@ahpd/sdk';
import { askToServe, configure, offerConfigure, under, type Configured } from '../src/commands/configure.js';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { missingLines } from '../src/found.js';
import type { Ran, Runner, RunOptions } from '../src/install.js';
import type { Fetch } from '../src/update.js';

let root: string;
let configDir: string;
let configFile: string;
/** The only folder on PATH, so what the command finds is what a case put there. */
let bin: string;
/** What each stub says for `--version`, by the name it was found under. */
const versions = new Map<string, string>();
/** The stubs whose `--version` exits non-zero. */
const failing = new Set<string>();
/** The stubs whose `--version` never answers, which is what the 3 seconds are for. */
const hanging = new Set<string>();
/** Every program a case ran, so a second run can be shown not to make an npm call. */
const calls: { program: string; argv: string[]; options?: RunOptions }[] = [];
/** The package a source names, without the version or tag after it. */
const packageSource = (source: string): string => {
  const at = source.indexOf('@', source.startsWith('@') ? 1 : 0);
  return at === -1 ? source : source.slice(0, at);
};

/**
 * The runner: npm always succeeds and lands what each source names, and a
 * `--version` is answered from the maps above rather than by the file, which is
 * a stub holding no code at all.
 */
const run: Runner = async (program, argv, options) => {
  calls.push({ program, argv: [...argv], ...(options === undefined ? {} : { options }) });
  // An install lands each source as the package it names, with the `ahpd`
  // field a plugin's manifest has: the install path reads that manifest to
  // tell a plugin from a package that is not one, and refuses one it cannot
  // find at all.
  if (argv[0] === 'install') {
    const into = argv[argv.indexOf('--prefix') + 1] as string;
    for (const source of argv.slice(argv.indexOf('--') + 1)) {
      const name = packageSource(source);
      const folder = join(into, 'node_modules', name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'package.json'), `${JSON.stringify({ name, version: '0.8.0', ahpd: { entry: './dist/index.js' } })}\n`);
    }
    return { code: 0, stdout: '', stderr: '' } satisfies Ran;
  }
  if (argv[0] !== '--version') return { code: 0, stdout: '', stderr: '' } satisfies Ran;
  const name = basename(program).replace(/\.(?:cmd|exe|bat|com)$/iu, '');
  if (hanging.has(name)) return { code: -1, stdout: '', stderr: '' } satisfies Ran;
  if (failing.has(name)) return { code: 1, stdout: '', stderr: 'no version' } satisfies Ran;
  return { code: 0, stdout: `${versions.get(name) ?? ''}\n`, stderr: '' } satisfies Ran;
};
/**
 * A registry holding one version of `@ahpd/agent-claude`, whose `@ahpd/sdk`
 * peer range admits this daemon's `0.8.0`; any other path is answered as the
 * manifest of a version that is a plugin.
 */
const packument = {
  versions: { '0.8.0': { peerDependencies: { '@ahpd/sdk': '>=0.8' } } },
  'dist-tags': { latest: '0.8.0' },
};
const fetch: Fetch = async (url) => Response.json(
  String(url).endsWith('@ahpd%2fagent-claude') ? packument : { ahpd: { entry: './dist/index.js' } },
);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-configure-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
  bin = join(root, 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  calls.length = 0;
  versions.clear();
  failing.clear();
  hanging.clear();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The eight main plugins a first run installs, in the order the questions offer them. */
const MAIN = ['@ahpd/web', '@ahpd/tasks', '@ahpd/computer', '@ahpd/push', '@ahpd/bot', '@ahpd/webhook', '@ahpd/tunnel-devtunnel', '@ahpd/activepieces'];

/** One run of `configure`, answering as the terminal gives, over this case's PATH. */
const asked = async (...answers: (string | Readonly<Record<string, string | readonly string[]>>)[]): Promise<{ answered: Configured; said: string }> => {
  const term = terminal(...answers);
  const lines: string[] = [];
  const answered = await configure({
    configDir, configFile, sdk: '0.8.0', term: term.term, run, fetch, path: bin, say: (line) => { lines.push(line); },
  });
  return { answered, said: `${term.said()}${lines.join('\n')}` };
};

/** The file a stub has in `bin` on this system, where npm installs a `.cmd` on Windows. */
const stubFile = (name: string): string => join(bin, process.platform === 'win32' ? `${name}.cmd` : name);

/** A command on PATH. It is never run: the runner above answers its version. */
const stub = (name: string, version?: string): void => {
  writeFileSync(stubFile(name), '#!/bin/sh\n');
  chmodSync(stubFile(name), 0o755);
  if (version !== undefined) versions.set(name, version);
};

/** A row by id, which every case here then has for sure. */
const row = (id: string): KnownAgent => {
  const agent = knownAgents[id];
  if (agent === undefined) throw new Error(`knownAgents has no ${id}`);
  return agent;
};

const put = (held: unknown): void => { writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const tokenFile = (): string => join(configDir, 'connection-token');

/** The `@ahpd/agent-acp` entry in the file, as an object, which every pi case writes. */
const acpEntry = (): Record<string, unknown> => {
  const entry = (read().plugins as unknown[]).find((one) => typeof one === 'object' && one !== null
    && ((one as Record<string, unknown>)['source'] ?? (one as Record<string, unknown>)['name']) === '@ahpd/agent-acp');
  if (entry === undefined) throw new Error('the file has no @ahpd/agent-acp entry');
  return entry as Record<string, unknown>;
};

/** The presets the `@ahpd/agent-acp` entry still holds, which the next start moves to records. */
const presetsOf = (): Record<string, unknown> => {
  const options = acpEntry()['options'];
  if (typeof options !== 'object' || options === null) return {};
  const presets = (options as Record<string, unknown>)['presets'];
  return typeof presets === 'object' && presets !== null ? presets as Record<string, unknown> : {};
};

/**
 * One agent record as the file keeps it, or nothing when there is none.
 *
 * An agent is a record on the agents channel now, and the daemon's store keeps
 * each one as `<configDir>/agents/<id>.json`.
 */
const recordOf = (id: string): Record<string, unknown> | undefined => {
  const file = join(configDir, 'agents', `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : undefined;
};

/** One agent record written the way the daemon keeps it: the whole record as pretty JSON. */
const putRecord = (record: Record<string, unknown>): void => {
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'agents', `${String(record['id'])}.json`), `${JSON.stringify(record, null, 2)}\n`);
};

/*
 * A folder under a served one, as VS Code's agent host tells a folder under a
 * trusted one: a letter's case ignored where the file system ignores it, and
 * kept on Linux, where `Work` and `work` are two folders.
 */
it('reads a folder under a served one as VS Code does, its letters\' case ignored except on Linux', () => {
  const served = join(tmpdir(), 'Work');
  expect(under(join(tmpdir(), 'work', 'app'), served, true)).toBe(true);
  expect(under(join(tmpdir(), 'WORK'), served, true)).toBe(true);
  expect(under(join(tmpdir(), 'workshop'), served, true)).toBe(false);
  expect(under(join(tmpdir(), 'work', 'app'), served, false)).toBe(false);
  expect(under(join(tmpdir(), 'Work', 'app'), served, false)).toBe(true);
  expect(under(join(tmpdir(), 'work', 'app'), served)).toBe(process.platform !== 'linux');
});

it('is a local command, and no served one', () => {
  const command = cliRegistry().find('daemon.configure');
  expect(command?.surfaces?.cli).toBe(true);
  // A served command carries its route under `meta`; this one asks questions.
  expect(command?.meta?.http).toBeUndefined();
});

it('writes the defaults on Enter at every question, and installs Claude and the web UI', async () => {
  const { answered } = await asked('', '', '', '', '', '');
  expect(answered.backends).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude']);
  expect(answered.paths).toEqual([process.cwd()]);

  expect(read()).toEqual({
    host: '127.0.0.1',
    port: 9187,
    connectionTokenFile: tokenFile(),
    paths: [process.cwd()],
    plugins: ['@ahpd/agent-acp', '@ahpd/agent-claude', ...MAIN],
  });
  // A secret, so Enter wrote one into the file beside the configuration and it
  // is not the empty string.
  expect(readFileSync(tokenFile(), 'utf8').trim().length).toBeGreaterThan(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.program).toBe('npm');
  expect(calls[0]?.argv).toContain('@ahpd/agent-claude@0.8.0');
  // ACP is on by default, as Claude is.
  expect(calls[0]?.argv).toContain('@ahpd/agent-acp');
  // The web UI is offered on a first run, and Enter takes it.
  expect(calls[0]?.argv).toContain('@ahpd/web');
});

it('offers ACP among the backends, and the main plugins in the other list', async () => {
  const { said } = await asked('', '', '', '', '', '', '', '');
  expect(said).toContain('ACP agents');
  for (const name of ['Web UI', 'Tasks', 'Computers', 'Push', 'Bots', 'Webhooks', 'Dev Tunnels', 'Activepieces']) {
    expect(said, name).toContain(name);
  }
});

it('asks for the plugin marketplaces last, and writes them only when the answer changes them', async () => {
  const first = await asked('', '', '', '', '', '');
  expect(first.said).toContain('Plugin marketplaces [https://plugins.ahpio.com/v1/plugins.json]');
  // Enter keeps the default, which stays unwritten so it moves with a release.
  expect(read().pluginMarketplaces).toBeUndefined();
  await asked({ 'Plugin marketplaces': 'https://a.example.com/v1/plugins.json, https://b.example.com/v1/plugins.json' });
  expect(read().pluginMarketplaces).toEqual(['https://a.example.com/v1/plugins.json', 'https://b.example.com/v1/plugins.json']);
  const again = await asked({ 'Plugin marketplaces': 'none' });
  expect(again.said).toContain('Plugin marketplaces [https://a.example.com/v1/plugins.json, https://b.example.com/v1/plugins.json]');
  expect(read().pluginMarketplaces).toEqual([]);
  const off = await asked();
  expect(off.said).toContain('Plugin marketplaces [none]');
  expect(read().pluginMarketplaces).toEqual([]);
});

it('leaves the web UI out when it is answered No on a first run', async () => {
  const { said } = await asked({ 'Which other plugins': ' ' });
  expect(said).toContain('Web UI');
  expect(read().plugins).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude', ...MAIN.slice(1)]);
  expect(calls.some((one) => one.argv.includes('@ahpd/web'))).toBe(false);
});

it('switches a web UI the file names off when it is answered No', async () => {
  put({ plugins: ['@ahpd/agent-claude', '@ahpd/web'] });
  await asked({ 'Which other plugins': ' ' });
  // A No is not a removal: the entry stays, saying it is off.
  expect(read().plugins).toEqual(['@ahpd/agent-claude', { source: '@ahpd/web', enabled: false }, '@ahpd/agent-acp']);
});

it('shows what it wrote as the default on a second run, and installs nothing again', async () => {
  await asked();
  const again = await asked();
  expect(again.said).toContain('Claude');
  // A backend the file already names is the answer Enter keeps.
  expect(again.said).toContain('cofold');
  expect(again.said).toContain('Host [127.0.0.1]');
  expect(again.said).toContain('Port [9187]');
  expect(again.said).toContain(`Serve ${process.cwd()}?`);
  // The token that is there is what Enter keeps, rather than a second one.
  expect(again.said).toContain(`Connection token [keep ${tokenFile()}]`);
  expect(calls).toHaveLength(1);
  expect(read().plugins).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude', ...MAIN]);
});

it('makes the configuration folder on a first run, rather than failing on the token file', async () => {
  // A machine that has never configured this daemon has neither the folder nor
  // anything in it, and the token is written before the configuration file is:
  // a `writeFileSync` that makes no folder fails the whole command at its last
  // question.
  const fresh = join(root, 'never-made');
  const file = join(fresh, 'config.json');
  const term = terminal('', '', '', '', '', '', '', '');
  const answered = await configure({
    configDir: fresh, configFile: file, sdk: '0.8.0', term: term.term, run, fetch, path: bin, say: () => {},
  });
  expect(answered.paths).toEqual([process.cwd()]);
  const wrote = join(fresh, 'connection-token');
  expect(existsSync(wrote)).toBe(true);
  expect(readFileSync(wrote, 'utf8').trim()).not.toBe('');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ connectionTokenFile: wrote });
});

it('writes a typed token to the token file', async () => {
  await asked({ 'Connection token': 'shh' });
  expect(read().connectionTokenFile).toBe(tokenFile());
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe('shh');
});

it('generates a token on Enter, and keeps the one already there', async () => {
  await asked('', '', '', '', '', '');
  const generated = readFileSync(tokenFile(), 'utf8').trim();
  expect(generated).not.toBe('');
  await asked('', '', '', '', '', '');
  // And a third run changes neither the token nor the file.
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe(generated);
});

it('reads a relative token file against the configuration folder, and keeps it as written', async () => {
  put({ connectionTokenFile: 'secret-token' });
  writeFileSync(join(configDir, 'secret-token'), 'kept\n');
  const { said } = await asked('', '', '', '', '', '');
  expect(said).toContain(`${join(configDir, 'secret-token')} still holds the token.`);
  expect(readFileSync(join(configDir, 'secret-token'), 'utf8').trim()).toBe('kept');
  expect(read().connectionTokenFile).toBe('secret-token');
  expect(existsSync(join(process.cwd(), 'secret-token'))).toBe(false);
});

it('keeps a token written as a literal, moving it into the token file', async () => {
  put({ connectionToken: 'old-shh' });
  const { said } = await asked('', '', '', '', '', '');
  // A token clients are already presenting is one Enter keeps, not one it
  // replaces: a fresh one here locks every one of them out.
  expect(said).toContain(`Connection token [keep the token in ${configFile}]`);
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe('old-shh');
  expect(read().connectionTokenFile).toBe(tokenFile());
  // And the literal is taken out, since `secret()` refuses both spellings.
  expect(read().connectionToken).toBeUndefined();
});

it('switches a backend the file names off when it is answered No, and on again when it is answered Yes', async () => {
  put({ plugins: ['@ahpd/agent-claude'] });
  await asked({ 'Which agent runtimes': '\x1b[B ' });
  // A No is not a removal: the entry stays, saying it is off, as
  // `ahpd plugin disable` writes it.
  expect(read().plugins).toEqual([{ source: '@ahpd/agent-claude', enabled: false }, '@ahpd/agent-acp']);

  put({ plugins: [{ name: '@ahpd/agent-claude', options: { model: 'opus' } }] });
  await asked('', '', '', '', '', '');
  // Enter keeps an entry that is on as it is written.
  expect(read().plugins).toEqual([{ name: '@ahpd/agent-claude', options: { model: 'opus' } }, '@ahpd/agent-acp']);
});

it('leaves a folder answered No out of paths', async () => {
  put({ paths: ['/tmp/one', '/tmp/two'] });
  const { answered } = await asked({ 'Serve /tmp/one?': 'n' });
  expect(answered.paths).toEqual(['/tmp/two']);
  expect(read().paths).toEqual(['/tmp/two']);
});

it('keeps a key it was not asked about', async () => {
  put({ users: '/tmp/people.json', advancedTools: true });
  await asked('', '', '', '', '', '');
  expect(read().users).toBe('/tmp/people.json');
  expect(read().advancedTools).toBe(true);
});

it('refuses a port that is not one, before anything is written', async () => {
  await expect(asked({ 'Port [': 'nine thousand' })).rejects.toThrow(/^Port must be a number from 0 to 65535, not nine thousand\.$/u);
  expect(existsSync(configFile)).toBe(false);
});

it('says why when every folder is answered No, and asks the folders again', async () => {
  put({ paths: ['/tmp/one'] });
  const { said, answered } = await asked({ 'Serve /tmp/one?': ['n', 'y'] });
  expect(said).toContain('Every folder was refused');
  expect(answered.paths).toEqual(['/tmp/one']);
});

describe('what is on PATH', () => {
  it('asks about a found agent, and a Yes writes it as a host record and names its plugin', async () => {
    stub('gemini', '0.9.0');
    const { said } = await asked();
    expect(said).toContain('Gemini');
    expect(read().plugins).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude', ...MAIN]);
    // The record is what the agents channel serves; the plugin is what registers
    // the engine it opens on, and the host is the owner a preset's agent had.
    expect(recordOf('gemini')).toMatchObject({
      id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: {},
    });
    // The package that runs it is installed with the backend, after the write.
    expect(calls.some((one) => one.program === 'npm' && one.argv.includes('@ahpd/agent-acp'))).toBe(true);
  });

  it('writes no record for an agent answered No, and keeps ACP on as a backend', async () => {
    stub('gemini', '0.9.0');
    // The agents found are a list of their own, with each ticked: Space unticks it.
    await asked({ 'Which agents found': ' ' });
    expect(recordOf('gemini')).toBeUndefined();
    expect(read().plugins).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude', ...MAIN]);
  });

  it('writes no agent-acp entry when ACP is ticked off as a backend', async () => {
    stub('gemini', '0.9.0');
    // ACP is the first backend, so Space alone unticks it.
    await asked({ 'Which agent runtimes': ' ' });
    expect(read().plugins).toEqual(['@ahpd/agent-claude', ...MAIN]);
    expect(calls.some((one) => one.argv.includes('@ahpd/agent-acp'))).toBe(false);
  });

  it('shows an agent the file has as a record as configured, asks nothing about it, and keeps it', async () => {
    put({ plugins: [{ name: '@ahpd/agent-acp', options: { hostTools: false } }] });
    putRecord({ id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: { model: 'flash' } });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (configured, @ahpd/agent-acp)');
    expect(said).not.toContain('Which agents found');
    expect(read().plugins).toEqual([
      { name: '@ahpd/agent-acp', options: { hostTools: false } },
      '@ahpd/agent-claude',
    ]);
    // Nothing here edits the record: the file as it was is the file it is.
    expect(recordOf('gemini')).toMatchObject({ config: { model: 'flash' } });
  });

  it('asks about an agent whose record is there but whose plugin the file does not name', async () => {
    // A record left behind by a setup that stopped before it wrote the file is
    // not one the daemon serves, so it is asked about, and the answer is what
    // puts the plugin that registers its engine in the file.
    putRecord({ id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: {} });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (not configured, @ahpd/agent-acp)');
    expect(said).toContain('Gemini');
    expect(read().plugins).toContain('@ahpd/agent-acp');
  });

  it('counts a preset the file still holds as configured, until the next start moves it', async () => {
    put({
      plugins: [{
        name: '@ahpd/agent-acp',
        options: { presets: { gemini: { model: 'flash' } }, hostTools: false },
      }],
    });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (configured, @ahpd/agent-acp)');
    expect(said).not.toContain('Which agents found');
    // The preset is still the only copy of the agent, so no record is made here.
    expect(recordOf('gemini')).toBeUndefined();
    expect(presetsOf()).toEqual({ gemini: { model: 'flash' } });
  });

  it('asks nothing about the ACP pi preset when the native pi backend is on', async () => {
    stub('pi-acp', '1.0.0');
    // Down three times to the pi backend and Space ticks it. ACP is on already.
    const { said } = await asked({ 'Which agent runtimes': '\x1b[B\x1b[B\x1b[B ' });
    expect(said).toContain('pi-acp: not asked, the pi backend runs pi');
    expect(said).not.toContain('Which agents found');
    // The one pi is the backend, and no preset or record was written for the ACP one.
    expect(read().plugins).toEqual(['@ahpd/agent-acp', '@ahpd/agent-claude', '@ahpd/agent-pi', ...MAIN]);
    expect(recordOf('pi')).toBeUndefined();
  });

  it('offers to remove an ACP pi agent the file has when the native pi backend is on', async () => {
    const both = {
      plugins: ['@ahpd/agent-pi', { name: '@ahpd/agent-acp', options: { presets: { pi: {} }, hostTools: false } }],
    };
    const record = { id: 'pi', engine: 'acp', owner: 'host', name: 'Pi', config: {} };
    put(both);
    putRecord(record);
    stub('pi-acp', '1.0.0');
    const yes = await asked();
    expect(yes.said).toContain('Remove the ACP pi agent? It clashes with the pi backend.');
    // The record and the preset are both of them: a file this start would move
    // its preset into a record otherwise has two agents of one id.
    expect(recordOf('pi')).toBeUndefined();
    expect(presetsOf()).toEqual({});
    // Dropping the agent keeps every other option the entry holds.
    expect((acpEntry()['options'] as Record<string, unknown>)['hostTools']).toBe(false);

    put(both);
    putRecord(record);
    const no = await asked({ 'Remove the ACP pi agent': 'n' });
    expect(no.said).toContain('Remove the ACP pi agent? It clashes with the pi backend.');
    expect(recordOf('pi')).toMatchObject({ id: 'pi', engine: 'acp' });
    expect(presetsOf()).toEqual({ pi: {} });
  });

  it('asks about the ACP pi agent when the native pi backend is answered No', async () => {
    stub('pi-acp', '1.0.0');
    // ACP is on by default and the pi backend is left off, so its agent is offered.
    const { said } = await asked();
    expect(said).toContain('Pi');
    expect(said).not.toContain('pi-acp: not asked, the pi backend runs pi');
    expect(recordOf('pi')).toMatchObject({ id: 'pi', engine: 'acp', owner: 'host', name: 'Pi', config: {} });
    expect(read().plugins).toContain('@ahpd/agent-acp');
  });

  it('lists every agent it did not find with the line that installs it', async () => {
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Agents not found:');
    expect(said).toContain(`  Codex: ${installLine(row('codex'), process.platform)}`);
    expect(said).toContain(`  OpenCode: ${installLine(row('opencode'), process.platform)}`);
    // A row with no line for this system shows its page instead of an empty one.
    expect(said).toContain(`  Amp: ${row('amp').page}`);
  });

  it('asks no agent question with an empty PATH, so the questions are the ones of today', async () => {
    const { said } = await asked('', '', '', '', '', '');
    for (const agent of Object.values(knownAgents)) {
      expect(said, `${agent.name} was asked about`).not.toContain(`${agent.name}?`);
    }
  });

  it('names the runtime versions the runner gave', async () => {
    stub('node', 'v24.21.0');
    stub('bun', '1.2.3');
    stub('deno', '2.0.0');
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Node v24.21.0 (runs ahpd)');
    expect(said).toContain('Bun 1.2.3 (runs ahpd)');
    expect(said).toContain('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
  });

  it('says ahpd does not run on Node 20', async () => {
    stub('node', 'v22.17.0');
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Node v22.17.0 (ahpd does not run on it; it needs Node 22.18 or newer)');
  });

  it('shows the version the runner gave for the agent it found', async () => {
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '');
    expect(said).toContain('Agents found:');
    expect(said).toContain('Gemini 0.9.0 (not configured, @ahpd/agent-acp)');
  });

  it('shows the path and no version when --version fails', async () => {
    stub('gemini');
    failing.add('gemini');
    const { said } = await asked({ 'Which agents found': ' ' });
    expect(said).toContain(`Gemini at ${stubFile('gemini')} (not configured, @ahpd/agent-acp)`);
    // The limit is what keeps an agent that checks for updates as it starts
    // from holding up the setup, so the probe is given it.
    const probe = calls.find((one) => one.program === stubFile('gemini') && one.argv[0] === '--version');
    expect(probe?.options).toEqual({ timeoutMs: 3000, capture: true });
  });

  it('shows the path and no version when --version passes the 3 seconds', async () => {
    stub('gemini');
    hanging.add('gemini');
    const { said } = await asked({ 'Which agents found': ' ' });
    expect(said).toContain(`Gemini at ${stubFile('gemini')} (not configured, @ahpd/agent-acp)`);
  });

  it('shows claude under Also found, and asks the three backend questions it always did', async () => {
    stub('claude', '2.1.291');
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('Also found:');
    expect(said).toContain('  claude 2.1.291');
    expect(said).toContain('Claude');
    expect(said).toContain('cofold');
    expect(said).toContain('pi');
  });

  it('shows an install line a record writes for a missing agent, not the row it shipped with', async () => {
    // The plugin is in the file, so the record is one this host serves and its
    // own install line is the one the person would run.
    put({ plugins: ['@ahpd/agent-acp'] });
    putRecord({
      id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini',
      config: { install: { all: 'npm i -g my-gemini' } },
    });
    const { said } = await asked('', '', '', '', '', '');
    expect(said).toContain('  Gemini: npm i -g my-gemini');
    expect(said).not.toContain('@google/gemini-cli');
  });

  it('shows a row page for a system the row has no line for', () => {
    const one: KnownAgent = {
      id: 'x', name: 'X',
      site: 'https://x.example', company: 'https://x.example',
      command: 'x',
      install: { linux: 'apt install x' },
      page: 'https://example.com/x',
      variables: [],
    };
    expect(missingLines([one], 'win32')).toEqual(['Agents not found:', '  X: https://example.com/x']);
  });

  it('shows the site when a row has neither a line for the system nor a page', () => {
    const one: KnownAgent = {
      id: 'x', name: 'X',
      site: 'https://x.example', company: 'https://x.example',
      command: 'x',
      variables: [],
    };
    expect(missingLines([one], 'win32')).toEqual(['Agents not found:', '  X: https://x.example']);
  });
});

describe('a start with no configuration', () => {
  /** One offer, answering as the terminal gives, and what it asked and ran. */
  const offer = async (configFile: string, term: ReturnType<typeof terminal>) => {
    const said: string[] = [];
    let ran = 0;
    const done = await offerConfigure({
      configFile, term: term.term, say: (line) => { said.push(line); },
      run: async () => { ran += 1; },
    });
    return { done, said: `${term.said()}${said.join('\n')}`, ran };
  };

  it('asks and runs it on yes, so the run that follows reads what it wrote', async () => {
    const term = terminal('');
    const { done, said, ran } = await offer(configFile, term);
    expect(done).toBe(true);
    expect(ran).toBe(1);
    expect(said).toContain('No configuration. Run ahpd configure now?');
  });

  it('says it did not run it on no, and refuses as a start with no backend does', async () => {
    const term = terminal('n');
    const { done, said, ran } = await offer(configFile, term);
    expect(done).toBe(false);
    expect(ran).toBe(0);
    expect(said).toContain('Not run.');
  });

  it('asks nothing at all without a terminal, or with a configuration there', async () => {
    const piped = terminal('');
    piped.term.input.isTTY = false;
    const silent = await offer(configFile, piped);
    expect(silent.said).toBe('');
    expect(silent.ran).toBe(0);

    put({ port: 9187 });
    const configured = terminal('');
    const answered = await offer(configFile, configured);
    expect(answered.done).toBe(false);
    expect(answered.ran).toBe(0);
    expect(configured.said()).toBe('');
  });
});

describe('a start in a folder nothing serves', () => {
  /** One question, over a file and flags as given, answering as the terminal gives. */
  const asked = async (held: unknown, flags: Record<string, unknown>, ...answers: string[]) => {
    put(held);
    const options = optionsFrom({ configFile, ...flags });
    const term = terminal(...answers);
    const lines: string[] = [];
    await askToServe(options, configFile, term.term, (line) => { lines.push(line); });
    return { paths: options.paths, said: `${term.said()}${lines.join('\n')}` };
  };

  it('asks on yes and writes the folder to paths, which this run serves too', async () => {
    const { paths, said } = await asked({ paths: ['/tmp/one'] }, {}, '');
    expect(said).toContain(`Serve ${process.cwd()}?`);
    // Enter keeps the No, so the folder has to be answered for it to be added.
    expect(paths).toEqual(['/tmp/one']);
    expect(read().paths).toEqual(['/tmp/one']);

    const yes = await asked({ paths: ['/tmp/one'] }, {}, 'y');
    expect(yes.paths).toEqual(['/tmp/one', process.cwd()]);
    expect(read().paths).toEqual(['/tmp/one', process.cwd()]);
  });

  it('asks nothing about a folder one that is served is under', async () => {
    const here = await asked({ paths: [process.cwd()] }, {});
    expect(here.said).toBe('');
    const above = await asked({ paths: [join(process.cwd(), '..')] }, {});
    expect(above.said).toBe('');
  });

  it('asks nothing under --no-cwd', async () => {
    const { paths, said } = await asked({ paths: ['/tmp/one'] }, { noCwd: true });
    expect(said).toBe('');
    expect(paths).toEqual(['/tmp/one']);
  });

  it('asks nothing without a terminal, and starts without it', async () => {
    put({ paths: ['/tmp/one'] });
    const options = optionsFrom({ configFile });
    const term = terminal('');
    term.term.input.isTTY = false;
    await askToServe(options, configFile, term.term, () => { throw new Error('something was said'); });
    expect(term.said()).toBe('');
    expect(options.paths).toEqual(['/tmp/one']);
    expect(read().paths).toEqual(['/tmp/one']);
  });
});
describe('people and policies', () => {
  /** Enter at each question of today, which the people and policy questions follow. */
  const usersOf = (path: string): { id: string; roles: string[] }[] =>
    (JSON.parse(readFileSync(path, 'utf8')) as { users: { id: string; roles: string[] }[] }).users;
  const rowsOf = (): { id: string; kind: string; match: Record<string, string[]> }[] =>
    (JSON.parse(readFileSync(join(configDir, 'policies.json'), 'utf8')) as { policies: { id: string; kind: string; match: Record<string, string[]> }[] }).policies;

  it('adds nobody and writes no users file on Enter', async () => {
    const { answered, said } = await asked();
    expect(said).toContain('Add a person now?');
    expect(answered.added).toEqual([]);
    expect(read().users).toBeUndefined();
    expect(said).not.toContain('ahpd user token');
    // A host with no people is never checked, so it is not asked.
    expect(said).not.toContain('Turn the policy checks on?');
  });

  it('adds a person as member on Enter, in a users file beside the configuration, and says how they connect', async () => {
    const { answered, said } = await asked({ 'Add a person now?': 'y', 'Their id': 'alice' });
    const file = join(configDir, 'users.json');
    expect(read().users).toBe(file);
    expect(usersOf(file)).toEqual([expect.objectContaining({ id: 'alice', roles: ['member'] })]);
    expect(answered.added).toEqual(['alice']);
    // The roles offered are the ones the host defines.
    expect(said).toContain('Roles (admin, guest, member; comma-separated) [member]');
    expect(said).toContain('Add another person?');
    expect(said).toContain('To connect as alice: ahpd user token alice --url');
  });

  it('gives every role a comma-separated answer names', async () => {
    await asked({ 'Add a person now?': 'y', 'Their id': 'bob', 'Roles (': 'member, guest' });
    expect(usersOf(join(configDir, 'users.json'))[0]?.roles).toEqual(['member', 'guest']);
  });

  it('asks the roles again after one the host does not define', async () => {
    const { said } = await asked({ 'Add a person now?': 'y', 'Their id': 'carol', 'Roles (': ['chief', ''] });
    expect(said).toContain('no role called chief; this host has admin, guest, member');
    expect(usersOf(join(configDir, 'users.json'))[0]?.roles).toEqual(['member']);
  });

  it('turns the checks on, keeps the other policy keys, and writes a starter row for each kind on Enter', async () => {
    put({ users: join(configDir, 'users.json'), policies: { payOrder: 'regular' } });
    const { said } = await asked({ 'Turn the policy checks on?': 'y' });
    expect(read().policies).toEqual({ payOrder: 'regular', check: true });
    expect(said).toContain('Allow every person every agent, computer, model? A model row opens every model to every person.');
    expect(rowsOf().map((row) => [row.id, row.kind, row.match])).toEqual([
      ['everyone-agent', 'agent', { agent: ['*'] }],
      ['everyone-computer', 'computer', { computer: ['*'] }],
      ['everyone-model', 'model', { model: ['*'] }],
    ]);
    expect(said).toContain('A running daemon reads them when it starts again.');
  });

  it('offers only the kinds no row allows to everyone', async () => {
    put({ users: join(configDir, 'users.json'), policies: { check: true } });
    writeFileSync(join(configDir, 'policies.json'), JSON.stringify({ version: 1, policies: [
      { id: 'all', scope: 'all', kind: 'agent', effect: 'allow', match: { agent: ['*'], computer: ['*'] } },
    ] }));
    const { said } = await asked();
    expect(said).toContain('Allow every person every computer, model?');
    expect(rowsOf().map((row) => row.id)).toEqual(['all', 'everyone-computer', 'everyone-model']);
  });

  it('keeps a different row under a starter id, and says the kind was skipped', async () => {
    put({ users: join(configDir, 'users.json'), policies: { check: true } });
    writeFileSync(join(configDir, 'policies.json'), JSON.stringify({ version: 1, policies: [
      { id: 'everyone-agent', scope: 'user:dave', kind: 'agent', effect: 'allow', match: { agent: ['claude'] } },
    ] }));
    const { said } = await asked();
    expect(said).toContain('The store already has a row everyone-agent, so no agent row was written.');
    expect(rowsOf().find((row) => row.id === 'everyone-agent')?.match).toEqual({ agent: ['claude'] });
  });

  it('reads a relative users path against the configuration folder, and keeps it as written', async () => {
    put({ users: 'people.json' });
    writeFileSync(join(configDir, 'people.json'), JSON.stringify({ roles: { senders: ['session:read'] }, users: [] }));
    const { said } = await asked({ 'Add a person now?': 'y', 'Their id': 'erin' });
    // The file's own role is offered, which only the file beside the
    // configuration holds.
    expect(said).toContain('Roles (admin, guest, member, senders; comma-separated) [member]');
    expect(usersOf(join(configDir, 'people.json')).map((one) => one.id)).toEqual(['erin']);
    expect(read().users).toBe('people.json');
    expect(existsSync(join(process.cwd(), 'people.json'))).toBe(false);
  });

  it('offers no row and writes no store with the checks off', async () => {
    put({ users: join(configDir, 'users.json') });
    const { said } = await asked();
    expect(said).toContain('Turn the policy checks on? A person no policy allows is refused.');
    expect(said).not.toContain('Allow every person');
    expect(read().policies).toBeUndefined();
    expect(existsSync(join(configDir, 'policies.json'))).toBe(false);
  });
});

describe('the listeners and the ACP agents to install', () => {
  // The first agent this host does not have is the first row with a line for
  // this system, so Space ticks it: the list starts with the cursor on it.
  const absent = (): KnownAgent => Object.values(knownAgents).find((agent) => installLine(agent, process.platform) !== undefined) as KnownAgent;
  const shell = (): string[] => calls.filter((one) => one.program === '/bin/sh' || one.program === 'cmd.exe').map((one) => one.argv.at(-1) ?? '');

  it('turns the HTTP API on at a port, and writes it as the port', async () => {
    await asked({ 'Serve the HTTP API?': 'y', 'Port for the HTTP API': '9300' });
    expect(read().httpApi).toEqual({ port: 9300 });
  });

  it('turns the HTTP API on as the daemon\'s own listener on Enter for the port', async () => {
    await asked({ 'Serve the HTTP API?': 'y' });
    expect(read().httpApi).toBe(true);
  });

  it('leaves the HTTP API out of the file on a first run answered No', async () => {
    await asked({ 'Serve the HTTP API?': 'n' });
    expect(read()).not.toHaveProperty('httpApi');
  });

  it('writes false for a listener the file had on and the person turns off', async () => {
    put({ modelApi: { port: 9400 } });
    await asked({ 'Serve the model gateway?': 'n' });
    expect(read().modelApi).toBe(false);
  });

  it('offers the model gateway with its current port as the answer Enter keeps', async () => {
    put({ modelApi: { port: 9400 } });
    const { said } = await asked({ 'Serve the model gateway?': 'y' });
    expect(said).toContain('Port for the model gateway, or own for the daemon\'s own listener [9400]');
    expect(read().modelApi).toEqual({ port: 9400 });
  });

  it('does not install an agent the list leaves unticked, even when the install is confirmed', async () => {
    await asked({ 'Run these install commands now?': 'y' });
    expect(shell()).toEqual([]);
    expect(recordOf(absent().id)).toBeUndefined();
  });

  it('runs the install line of a ticked agent when the person confirms it, and writes its record', async () => {
    const agent = absent();
    const line = installLine(agent, process.platform) as string;
    const { said } = await asked({ 'Which ACP agents not found': ' ', 'Run these install commands now?': 'y' });
    expect(said).toContain(`Installing ${agent.name}: ${line}`);
    expect(shell()).toEqual([line]);
    expect(recordOf(agent.id)).toMatchObject({ id: agent.id, engine: 'acp' });
  });

  it('shows the ticked agent\'s line, and runs nothing, when the install is declined', async () => {
    const agent = absent();
    await asked({ 'Which ACP agents not found': ' ', 'Run these install commands now?': 'n' });
    expect(shell()).toEqual([]);
    expect(recordOf(agent.id)).toBeUndefined();
  });
});
