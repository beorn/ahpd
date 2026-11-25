/**
 * The files an install of ahpd on a box is made from, held by this host for a
 * box that cannot download them: the Node of the box's platform, and npm's
 * cache of every package the ahpd part's locks name for it, sent as one tar.
 * The box checks Node by its sum and each package by its lock's integrity, as
 * it checks a download.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { launch } from '@ahpd/sdk';
import { lockFilesOf, once, PART_NPM_FLAGS, PART_PLUGIN_FLAGS, tarEntry } from './parts.js';
import type { HostInstall } from './hostinstall.js';

/** One npm run, in `cwd`: its exit code and its standard error. */
export type Npm = (args: string[], cwd: string) => Promise<{ code: number; stderr: string }>;

/** What a copy is made with. */
export interface CopyOptions {
  /** The folder the copies are kept in, the user's cache folder when absent. */
  cache?: string;
  /** How npm is run, as `ahpd plugin install` runs it when absent. */
  npm?: Npm;
}

/** How long a copy no box asked for is kept: another daemon of this user may hold another version's. */
const KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** How long one download or npm run is given. */
const FILL_MS = 10 * 60_000;

/** Where the copies are, owner-only, since a box runs what is in them. */
const cacheFolder = async (options: CopyOptions): Promise<string> => {
  const at = options.cache ?? join(process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'ahpd', 'host-copies');
  await mkdir(at, { recursive: true, mode: 0o700 });
  await chmod(at, 0o700);
  return at;
};

/** npm, started as the daemon starts it for a plugin. */
const npmRun: Npm = (args, cwd) => new Promise((done) => {
  const how = launch('npm', args, process.platform, process.env, process.execPath, existsSync);
  const child = spawn(how.command, how.args, { cwd, shell: how.shell, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: FILL_MS, killSignal: 'SIGKILL' });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.once('error', (error) => { done({ code: -1, stderr: error.message }); });
  child.once('close', (code) => { done({ code: code ?? -1, stderr }); });
});

/** The Node download of a platform, at `path` once its sum is the pinned one. */
const download = async (from: { url: string; sha256: string }, path: string): Promise<void> => {
  const said = await fetch(from.url, { signal: AbortSignal.timeout(FILL_MS) });
  if (!said.ok || said.body === null) throw new Error(`${from.url} answered HTTP ${said.status}`);
  await pipeline(said.body, createWriteStream(path));
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  const sum = hash.digest('hex');
  if (sum !== from.sha256) throw new Error(`${from.url} is ${sum}, and the parts file names ${from.sha256}`);
};

/**
 * npm's cache of one lock's packages for a platform: an `npm ci` of it in a
 * folder of its own that is thrown away, which runs no package's scripts here,
 * since they are for the box.
 */
const fill = async (npm: Npm, install: HostInstall, plugins: boolean, platform: string, at: string): Promise<void> => {
  const [os, cpu] = platform.split('-') as [string, string];
  const dir = join(at, plugins ? 'plugins' : 'server');
  await mkdir(dir);
  for (const one of lockFilesOf(install.lock, plugins)) await writeFile(join(dir, one.name.slice(one.name.lastIndexOf('/') + 1)), one.bytes);
  const ran = await npm([
    'ci', '--ignore-scripts', '--os', os, '--cpu', cpu, '--libc', 'glibc', '--cache', join(at, 'npm'),
    ...(plugins ? PART_PLUGIN_FLAGS : PART_NPM_FLAGS).split(' '),
  ], dir);
  if (ran.code !== 0) throw new Error(`npm did not download ahpd ${install.version}: ${ran.stderr.trim().split('\n').at(-1) || `exit ${ran.code}`}`);
  await rm(dir, { recursive: true, force: true });
};

/** Removes each copy and each stopped fill that nothing used for `KEPT_MS`. */
const sweep = async (root: string): Promise<void> => {
  for (const name of await readdir(root)) {
    const at = join(root, name);
    const used = await stat(at).catch(() => undefined);
    if (used !== undefined && Date.now() - used.mtimeMs > KEPT_MS) await rm(at, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * The folder of an install's files for a platform, filled the first time it is
 * asked for and kept. It is filled beside its place and renamed into it, so a
 * folder at its path is always whole.
 */
export const copyFolder = async (install: HostInstall, platform: string, options: CopyOptions = {}): Promise<string> => {
  const node = install.node[platform];
  if (node === undefined) throw new Error(`versions.json names no Node download for ${platform}`);
  const root = await cacheFolder(options);
  const at = join(root, `${install.key}-${platform}`);
  return once(at, async () => {
    if (!existsSync(at)) {
      const tmp = await mkdtemp(join(root, '.fill-'));
      try {
        await download(node, join(tmp, 'node.tar'));
        for (const plugins of [false, true]) {
          if (lockFilesOf(install.lock, plugins).length > 0) await fill(options.npm ?? npmRun, install, plugins, platform, tmp);
        }
        // npm's logs of the fill are of no use to a box.
        await rm(join(tmp, 'npm', '_logs'), { recursive: true, force: true });
        // Another process of this user may have put it there first, and its copy is as whole.
        await rename(tmp, at).catch((error: unknown) => { if (!existsSync(at)) throw error; });
      }
      finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
    const now = new Date();
    await utimes(at, now, now);
    await sweep(root).catch(() => {});
    return at;
  });
};

/** A folder as one tar, its files read one at a time and named from it with `/`. */
export const tarOf = (dir: string): Readable => Readable.from((async function* () {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const one of entries) {
    if (!one.isFile()) continue;
    const path = join(one.parentPath, one.name);
    yield tarEntry({ name: relative(dir, path).replaceAll('\\', '/'), bytes: await readFile(path) });
  }
  yield Buffer.alloc(1024);
})(), { objectMode: false });
