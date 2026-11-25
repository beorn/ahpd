import { posix } from '../../../tools/posix.ts';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { copyFolder } from '../src/hostcopy.js';
import { hostInstallOf } from '../src/hostinstall.js';
import { archiveOf } from '../src/parts.js';
import type { Npm } from '../src/hostcopy.js';
import type { Part } from '../src/parts.js';
import { quote, sshRuntime } from '../src/ssh.js';
import type { SshMachine } from '../src/ssh.js';
import { PROCESS_CASE_MS } from '../../../tools/wait.ts';

// Each scripted CLI call is a process of its own: see `PROCESS_CASE_MS`.
vi.setConfig({ testTimeout: PROCESS_CASE_MS });

/*
 * The ahpd this host installs on a box it reaches over ssh.
 *
 * The box is this host, through the scripted ssh, which runs the install's
 * script with this host's `sh`: so the script runs as it does on a box, with a
 * Node download made here, which `curl` reads from a `file:` URL, whose `node`
 * runs this process's own Node and whose `npm` writes a stand-in ahpd. Nothing
 * reaches the network.
 *
 * POSIX-only, every case: the script is a POSIX `sh` script and the download
 * is a tar archive of shell scripts.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});
/** The server a case's Node download is on, for a host that reads it by HTTP. */
let served: Server | undefined;
afterEach(() => { served?.close(); served = undefined; });
const temp = (): string => (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-hostinstall-')));

/** The ahpd the stand-in npm writes: it answers `--version`. */
const AHPD_STANDIN = `#!/usr/bin/env node
if (process.argv[2] === '--version') console.log('9.9.9');
`;

/**
 * The npm in the download: it records its arguments, refuses a prefix with no
 * lock in it, as `npm ci` does, and writes the stand-in ahpd under the prefix.
 */
const NPM_STANDIN = `#!/bin/sh
echo "$*" >> "$NPM_LOG"
echo "\${npm_config_offline:-} $(ls "\${npm_config_cache:-/nowhere}" 2>/dev/null)" >> "$NPM_LOG.env"
while [ "$#" -gt 0 ]; do
  case "$1" in --prefix) prefix=$2; shift ;; esac
  shift
done
[ -f "$prefix/package.json" ] && [ -f "$prefix/package-lock.json" ] || { echo "npm ci: no lock in $prefix" >&2; exit 1; }
mkdir -p "$prefix/node_modules/.bin" && cp "$(dirname "$0")/../share/ahpd.js" "$prefix/node_modules/.bin/ahpd"
`;

/** The ahpd part's four files, standing in for the ones `lockOf` reads. */
const LOCK = [
  { name: 'package.json', bytes: Buffer.from('{\n  "name": "ahpd-part-ahpd",\n  "private": true\n}\n') },
  { name: 'package-lock.json', bytes: Buffer.from('{\n  "lockfileVersion": 3\n}\n') },
  { name: 'plugins/package.json', bytes: Buffer.from('{\n  "name": "ahpd-part-ahpd-plugins"\n}\n') },
  { name: 'plugins/package-lock.json', bytes: Buffer.from('{\n  "lockfileVersion": 3\n}\n') },
];

/** The lock with its plugins' lock moved. */
const MOVED = LOCK.map((one) => (one.name === 'plugins/package-lock.json' ? { ...one, bytes: Buffer.from('{\n  "lockfileVersion": 4\n}\n') } : one));

/** A Node download, packed as the box unpacks it, and its sha256. */
const download = (): { url: string; sha256: string } => {
  const dir = join(temp(), 'publisher');
  const top = join(dir, 'node-v0-linux');
  mkdirSync(join(top, 'bin'), { recursive: true });
  mkdirSync(join(top, 'share'), { recursive: true });
  writeFileSync(join(top, 'bin', 'node'), `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(top, 'bin', 'npm'), NPM_STANDIN, { mode: 0o755 });
  writeFileSync(join(top, 'share', 'ahpd.js'), AHPD_STANDIN, { mode: 0o755 });
  const archive = join(dir, 'node.tar.gz');
  expect(spawnSync('tar', ['-czf', archive, '-C', dir, 'node-v0-linux']).status).toBe(0);
  return { url: `file://${archive}`, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
};

/** The parts file of a box install: one Node download for both machines, and ahpd 9.9.9 with two plugins. */
const partsWith = (node: { url: string; sha256: string }): Part[] => [
  { id: 'node', name: 'Node', kind: 'node', version: '0.0.0', archives: { 'linux-x64': node, 'linux-arm64': node }, bin: ['node', 'npm', 'npx'] },
  { id: 'ahpd', name: 'ahpd', kind: 'ahpd', version: '9.9.9', requires: ['node'], plugins: ['@ahpd/agent-cofold', '@ahpd/agent-pi'], bin: ['ahpd'] },
];

/** Where the box keeps its installs. */
const installs = (): string => join(temp(), 'data', 'ahpd', 'server');

/** The ssh runtime with the box dev02, which is this host, and the lines its log was given. */
const box = (parts: Part[], options: { env?: Record<string, string>; machine?: Partial<SshMachine>; npm?: Npm } = {}) => {
  const logged: string[] = [];
  const runtime = sshRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: {
      SSH_FAKE_LOG: join(temp(), 'ssh.jsonl'),
      XDG_DATA_HOME: join(temp(), 'data'),
      HOME: temp(),
      NPM_LOG: join(temp(), 'npm.log'),
      ...options.env,
    },
    machines: { dev02: { destination: 'dev02', ...options.machine } },
    parts,
    lock: LOCK,
    copy: { cache: join(temp(), 'copies'), npm: options.npm ?? (async () => ({ code: 1, stderr: 'this host has no npm' })) },
    log: (line) => { logged.push(line); },
  });
  return { runtime, logged };
};

/** What the stand-in npm was asked, one line per run. */
const npmRuns = (): string[] => (existsSync(join(temp(), 'npm.log'))
  ? readFileSync(join(temp(), 'npm.log'), 'utf8').trim().split('\n')
  : []);

/** An ahpd at `path` that answers `--version` with `version`. */
const standing = (path: string, version: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
};

it.skipIf(!posix)('installs ahpd in the box user folder the first time, and starts the host from there', async () => {
  const parts = partsWith(download());
  const { key } = hostInstallOf(parts, LOCK);
  const { runtime, logged } = box(parts);

  const command = await runtime.hostCommand('dev02');
  const dir = join(installs(), key);
  expect(command).toEqual(['env', `AHPD_PLUGIN_ROOT=${join(dir, 'ahpd', 'plugins')}`, join(dir, 'bin', 'ahpd')]);
  // The launcher runs the ahpd npm installed on the download's Node.
  expect(spawnSync(join(dir, 'bin', 'ahpd'), ['--version'], { encoding: 'utf8' }).stdout.trim()).toBe('9.9.9');
  // ahpd from the ahpd part's lock, written byte for byte, by `npm ci` with the part's flags.
  for (const one of LOCK) expect(readFileSync(join(dir, 'ahpd', one.name))).toEqual(one.bytes);
  const [run, plugins] = npmRuns();
  expect(run?.split(' ').slice(0, 2)).toEqual(['ci', '--prefix']);
  expect(run?.split(' ').slice(3)).toEqual(['--no-audit', '--no-fund', '--loglevel=error']);
  // The plugins from their own lock, into the install's own root.
  expect(plugins?.split(' ')[2]).toBe(`${run?.split(' ')[2]}/plugins`);
  expect(plugins?.split(' ').slice(3)).toEqual(['--legacy-peer-deps', '--no-audit', '--no-fund', '--loglevel=error']);
  expect(existsSync(join(dir, 'ahpd', 'plugins', 'node_modules'))).toBe(true);
  // A plugin lock that moves is another install.
  expect(hostInstallOf(parts, MOVED).key).not.toBe(key);
  // The folder the download was unpacked in went into place, and nothing else is left.
  expect(readdirSync(installs())).toEqual([key]);
  expect(logged).toEqual([`ahpd 9.9.9 was installed on dev02 at ${join(dir, 'bin', 'ahpd')}`]);
});

it.skipIf(!posix)('starts the host from the install it finds, and downloads nothing', async () => {
  const parts = partsWith(download());
  const first = box(parts);
  const command = await first.runtime.hostCommand('dev02');

  const second = box(parts);
  expect(await second.runtime.hostCommand('dev02')).toEqual(command);
  expect(npmRuns()).toHaveLength(2);
  expect(second.logged).toEqual([]);
});

it.skipIf(!posix)('installs once for two sessions starting on one box at once', async () => {
  const parts = partsWith(download());
  const { runtime } = box(parts);

  const [one, two] = await Promise.all([runtime.hostCommand('dev02'), runtime.hostCommand('dev02')]);
  expect(one).toEqual(two);
  expect(npmRuns()).toHaveLength(2);
  expect(readFileSync(join(temp(), 'ssh.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
});

it.skipIf(!posix)('runs the command the box names as it is, and installs nothing', async () => {
  const { runtime } = box(partsWith(download()), { machine: { host: ['ahpd'] } });

  expect(await runtime.hostCommand('dev02')).toEqual(['ahpd']);
  expect(existsSync(join(temp(), 'ssh.jsonl'))).toBe(false);
});

it.skipIf(!posix)('keeps the five installs used most recently', async () => {
  const parts = partsWith(download());
  const { key } = hostInstallOf(parts, LOCK);
  const older = [0, 1, 2, 3, 4, 5].map((at) => `1.0.${at}-00000000000${at}`);
  for (const [at, name] of older.entries()) {
    mkdirSync(join(installs(), name), { recursive: true });
    const when = new Date(Date.UTC(2026, 0, 1 + at));
    utimesSync(join(installs(), name), when, when);
  }

  await box(parts).runtime.hostCommand('dev02');
  expect(readdirSync(installs()).sort()).toEqual([...older.slice(2), key].sort());
});

it.skipIf(!posix)('starts the newest other install when the download fails, and says why', async () => {
  const parts = partsWith({ url: `file://${join(temp(), 'missing.tar.gz')}`, sha256: '0'.repeat(64) });
  const old = join(installs(), '9.9.8-0123456789ab');
  standing(join(old, 'bin', 'ahpd'), '9.9.8');
  const { runtime, logged } = box(parts);

  expect(await runtime.hostCommand('dev02')).toEqual(['env', `AHPD_PLUGIN_ROOT=${join(old, 'ahpd', 'plugins')}`, join(old, 'bin', 'ahpd')]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(new RegExp(`^ahpd 9\\.9\\.9 was not installed on dev02, so ${join(old, 'bin', 'ahpd').replaceAll('.', '\\.')} there starts its sessions' host: curl: `));
});

it.skipIf(!posix)('refuses with the install own line and why no copy was made, when the download fails and no other install of this host is there, whatever ahpd the PATH holds', async () => {
  const parts = partsWith({ url: `file://${join(temp(), 'missing.tar.gz')}`, sha256: '0'.repeat(64) });
  const bin = join(temp(), 'bin');
  standing(join(bin, 'ahpd'), '0.13.0');
  const { runtime, logged } = box(parts, { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow(/^ahpd 9\.9\.9 was not installed on dev02: curl: .*; and this host could not send its files: /);
  expect(logged).toEqual([expect.stringMatching(/^ahpd 9\.9\.9 was not installed on dev02, so this host sends it the files: curl: /)]);
});

it.skipIf(!posix)('refuses with the box own line when no ahpd can start there', async () => {
  const node = download();
  const parts = partsWith({ ...node, sha256: '0'.repeat(64) });
  const { runtime, logged } = box(parts, { env: { PATH: '/usr/bin:/bin' } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow(/^ahpd 9\.9\.9 was not installed on dev02: .*checksum/);
  expect(logged).toHaveLength(1);
  // A download that did not check out is never put in place.
  expect(existsSync(installs()) ? readdirSync(installs()) : []).toEqual([]);
});

it.skipIf(!posix)('refuses a box no download is made for, in the words VS Code refuses one with, before any install runs', async () => {
  const bin = join(temp(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo FreeBSD ;; -m) echo amd64 ;; esac\n', { mode: 0o755 });
  // An install of this host's there runs nothing either: the platform is asked first.
  standing(join(installs(), '9.9.8-0123456789ab', 'bin', 'ahpd'), '9.9.8');
  const { runtime, logged } = box(partsWith(download()), { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow('ahpd 9.9.9 was not installed on dev02: Unsupported remote platform: FreeBSD amd64');
  expect(npmRuns()).toEqual([]);
  expect(logged).toEqual([]);
  // Nor is a copy made for it.
  expect(existsSync(join(temp(), 'copies'))).toBe(false);
});

it.skipIf(!posix)('refuses a folder the box answers that is not one of this host installs', async () => {
  // The box's `sh`, which reads the script and answers with a folder outside the
  // installs, in the form the install answers in.
  const bin = join(temp(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'sh'), [
    '#!/bin/sh',
    'cat > /dev/null',
    `echo "root=${installs()}"`,
    'echo "install=/usr/local/elsewhere"',
    'echo "host=/usr/local/elsewhere/bin/ahpd"',
    '',
  ].join('\n'), { mode: 0o755 });
  const { runtime } = box(partsWith(download()), { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects
    .toThrow('ahpd 9.9.9 was not installed on dev02: the box answered "/usr/local/elsewhere", which is not one of this host\'s installs');
});

/** A Node download on a server this host reads, and a PATH whose `curl` reaches nothing, as a box with no internet has. */
const cutOff = async (): Promise<{ node: { url: string; sha256: string }; env: Record<string, string>; asked: () => number }> => {
  const made = download();
  let count = 0;
  const server = createServer((_, answer) => { count += 1; answer.end(readFileSync(made.url.slice('file://'.length))); });
  served = server;
  await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
  const bin = join(temp(), 'cut-off');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "curl: (6) Could not resolve host" >&2\nexit 6\n', { mode: 0o755 });
  return {
    node: { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/node.tar.gz`, sha256: made.sha256 },
    env: { PATH: `${bin}:/usr/bin:/bin` },
    asked: () => count,
  };
};

/** An npm on this host that records each run, and leaves one package in its cache, by a name as long as npm's. */
const hostNpm = () => {
  const runs: string[][] = [];
  const npm: Npm = async (args, cwd) => {
    expect(existsSync(join(cwd, 'package-lock.json'))).toBe(true);
    runs.push(args);
    const at = join(args[args.indexOf('--cache') + 1] ?? '', '_cacache', 'content-v2', 'sha512', 'ab', 'cd');
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'e'.repeat(124)), 'a package');
    return { code: 0, stderr: '' };
  };
  return { npm, runs };
};

it.skipIf(!posix)('sends a box that cannot download the files, and the box installs from them', async () => {
  const { node, env, asked } = await cutOff();
  const parts = partsWith(node);
  const { npm, runs } = hostNpm();
  const { key } = hostInstallOf(parts, LOCK);
  const { runtime, logged } = box(parts, { env, npm });

  const command = await runtime.hostCommand('dev02');
  // The same install, at the same key, as one the box downloads.
  expect(command?.at(-1)).toBe(join(installs(), key, 'bin', 'ahpd'));
  expect(spawnSync(join(installs(), key, 'bin', 'ahpd'), ['--version'], { encoding: 'utf8' }).stdout.trim()).toBe('9.9.9');
  // Both locks were filled for the box's platform, and no script ran here.
  const cpu = process.arch === 'arm64' ? 'arm64' : 'x64';
  expect(runs.map((one) => one.slice(0, 8))).toEqual([0, 1].map(() => ['ci', '--ignore-scripts', '--os', 'linux', '--cpu', cpu, '--libc', 'glibc']));
  expect(runs[1]).toContain('--legacy-peer-deps');
  // The box's npm read the copy's cache and asked no registry.
  expect(readFileSync(join(temp(), 'npm.log.env'), 'utf8')).toBe('true _cacache\ntrue _cacache\n');
  // The copy is gone from the box, and kept here.
  expect(readdirSync(installs())).toEqual([key]);
  expect(readdirSync(join(temp(), 'copies'))).toEqual([`${key}-linux-${cpu}`]);
  expect(asked()).toBe(1);
  expect(logged).toEqual([
    'ahpd 9.9.9 was not installed on dev02, so this host sends it the files: curl: (6) Could not resolve host',
    `ahpd 9.9.9 was installed on dev02 at ${join(installs(), key, 'bin', 'ahpd')}`,
  ]);

  // A second box is sent the files this host kept.
  rmSync(installs(), { recursive: true, force: true });
  await box(parts, { env, npm }).runtime.hostCommand('dev02');
  expect(asked()).toBe(1);
  expect(runs).toHaveLength(2);
});

it.skipIf(!posix)('runs the older install of a box that cannot download, and sends nothing', async () => {
  const { node, env, asked } = await cutOff();
  const old = join(installs(), '9.9.8-0123456789ab');
  standing(join(old, 'bin', 'ahpd'), '9.9.8');
  const { npm, runs } = hostNpm();
  const { runtime } = box(partsWith(node), { env, npm });

  expect((await runtime.hostCommand('dev02'))?.at(-1)).toBe(join(old, 'bin', 'ahpd'));
  expect(asked()).toBe(0);
  expect(runs).toEqual([]);
});

it.skipIf(!posix)('sends a Node that is not its sum to no box, and keeps no half copy', async () => {
  const { node, env } = await cutOff();
  const { npm } = hostNpm();
  const { runtime } = box(partsWith({ ...node, sha256: '0'.repeat(64) }), { env, npm });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow(/curl: \(6\) .*; and this host could not send its files: .* and the parts file names 0{64}$/);
  expect(readdirSync(join(temp(), 'copies'))).toEqual([]);
  expect(existsSync(installs()) ? readdirSync(installs()) : []).toEqual([]);
});

it.skipIf(!posix)('refuses on the box a Node that moved after this host kept it, and removes the copy', async () => {
  const { node, env } = await cutOff();
  const parts = partsWith(node);
  const { npm } = hostNpm();
  await box(parts, { env, npm }).runtime.hostCommand('dev02');
  rmSync(installs(), { recursive: true, force: true });
  const [kept] = readdirSync(join(temp(), 'copies'));
  writeFileSync(join(temp(), 'copies', kept ?? '', 'node.tar'), 'moved');

  await expect(box(parts, { env, npm }).runtime.hostCommand('dev02')).rejects.toThrow(/curl: \(6\) .*; and not from this host's files: .*checksum/);
  expect(readdirSync(installs())).toEqual([]);
});

it.skipIf(!posix)('fills one copy for two boxes that ask at once, and fills again after one that failed', async () => {
  const { node, asked } = await cutOff();
  const install = hostInstallOf(partsWith(node), LOCK);
  const { npm, runs } = hostNpm();
  const cache = join(temp(), 'copies');

  await expect(copyFolder(install, 'linux-x64', { cache, npm: async () => ({ code: 1, stderr: 'no route\n' }) })).rejects.toThrow('npm did not download ahpd 9.9.9: no route');
  expect(readdirSync(cache)).toEqual([]);
  const [one, two] = await Promise.all([copyFolder(install, 'linux-x64', { cache, npm }), copyFolder(install, 'linux-x64', { cache, npm })]);
  expect(one).toBe(two);
  expect(runs).toHaveLength(2);
  expect(asked()).toBe(2);

  // One no box asked for in a week goes with the next that is.
  const old = join(cache, '9.9.8-0123456789ab-linux-x64');
  mkdirSync(old);
  const when = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(old, when, when);
  await copyFolder(install, 'linux-x64', { cache, npm });
  expect(existsSync(old)).toBe(false);
});

it.skipIf(!posix)('writes a name over the tar header fields so that tar reads it whole', () => {
  const name = `npm/${'e'.repeat(130)}`;
  const listed = spawnSync('tar', ['-tf', '-'], { input: archiveOf([{ name, bytes: Buffer.from('one') }, { name: 'short', bytes: Buffer.from('two') }]), encoding: 'utf8' });
  expect(listed.stdout).toBe(`${name}\nshort\n`);
});
