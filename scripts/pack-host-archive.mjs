#!/usr/bin/env node
// Pack the customer host archive for one platform: @ahpd/server with its production node_modules fully resolved,
// so a host needs no package manager (#38280, @cto 078f53e9). Run it on the machine it builds for: native modules
// are taken for this machine, never cross-built.
//
//   node scripts/pack-host-archive.mjs --commit <full sha> --tag <release tag> --out <empty dir>
//
// Writes <out>/ahpd-<version>-<platform>-<arch>.tar.gz and <out>/pins-<platform>-<arch>.json. Refuses, by name:
// a dirty tree, a HEAD that is not the commit, an @ahpd/* package that did not come from this workspace, a
// non-empty output folder, and a missing build output. Prints the node, pnpm, bun and tar versions it used, so
// two builds can be compared.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = 'https://github.com/beorn/ahpd';
const PLATFORMS = { linux: 'linux', darwin: 'darwin' };
const ARCHES = { x64: 'x64', arm64: 'arm64' };

const fail = (message) => {
  process.stderr.write(`pack-host-archive: refused: ${message}\n`);
  process.exit(2);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) fail(`${command} ${args.join(' ')} could not start: ${result.error.message}`);
  return result;
};

const must = (command, args, options = {}) => {
  const result = run(command, args, options);
  if (result.status !== 0)
    fail(`${command} ${args.join(' ')} exited ${result.status}\n${(result.stdout ?? '').slice(-2000)}${(result.stderr ?? '').slice(-2000)}`);
  return result.stdout.trim();
};

const arg = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} is required`);
  return value;
};

const commit = arg('commit');
const tag = arg('tag');
const out = resolve(arg('out'));
const root = must('git', ['rev-parse', '--show-toplevel']);

// The commit, exactly, and nothing beside it.
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`--commit must be a full 40-character sha, got ${commit}`);
const head = must('git', ['rev-parse', 'HEAD'], { cwd: root });
if (head !== commit) fail(`HEAD is ${head}, not --commit ${commit}; check out the commit first`);
const dirty = must('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root });
if (dirty !== '') fail(`the tree is dirty:\n${dirty}`);
if (existsSync(out) && readdirSync(out).length > 0) fail(`--out ${out} is not empty`);

const platform = PLATFORMS[process.platform] ?? fail(`platform ${process.platform} is not one we ship`);
const arch = ARCHES[process.arch] ?? fail(`arch ${process.arch} is not one we ship`);
const tar = process.platform === 'darwin' ? 'gtar' : 'tar';
if (!/GNU tar/.test(run(tar, ['--version']).stdout ?? '')) fail(`${tar} is not GNU tar; the archive needs --sort and --mtime`);

const versions = {
  node: process.version,
  pnpm: must('corepack', ['pnpm', '--version'], { cwd: root }),
  bun: run('bun', ['--version']).stdout?.trim() || 'absent',
  tar: must(tar, ['--version']).split('\n')[0],
};
process.stdout.write(`pack-host-archive: node ${versions.node}, pnpm ${versions.pnpm}, bun ${versions.bun}, ${versions.tar}\n`);

// Every @ahpd/* the lockfile resolves must be this workspace's own package: a registry or URL copy is refused by
// name, before anything is installed. Workspace packages are `link:` importers and never appear as package keys.
const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
const foreignInLock = [...new Set([...lock.matchAll(/^ {2}'?(@ahpd\/[^@\s']+)@([^:\s']+)'?:\s*$/gm)].map((m) => `${m[1]}@${m[2]}`))];
if (foreignInLock.length > 0) fail(`pnpm-lock.yaml resolves @ahpd packages from outside the workspace: ${foreignInLock.join(', ')}`);

must('corepack', ['pnpm', 'install', '--frozen-lockfile'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
// tsc in dependency order over the server's closure. The known type errors (packages/server listener.ts FormData)
// do not stop emit; a missing dist does.
const built = run('corepack', ['pnpm', '--filter', '@ahpd/server...', '-r', '--workspace-concurrency=1', 'exec', 'tsc', '-p', '.'], { cwd: root });
const typeErrors = ((built.stdout ?? '') + (built.stderr ?? '')).split('\n').filter((line) => /error TS\d+/.test(line));
if (!existsSync(join(root, 'packages/server/dist/main.js'))) fail(`no packages/server/dist/main.js after the build:\n${typeErrors.join('\n')}`);
process.stdout.write(`pack-host-archive: build emitted with ${typeErrors.length} type error(s)${typeErrors.length ? `:\n${typeErrors.join('\n')}` : ''}\n`);

mkdirSync(out, { recursive: true });
const stage = join(out, 'stage');
must('corepack', ['pnpm', '--filter', '@ahpd/server', '--config.inject-workspace-packages=true', 'deploy', '--prod', stage], { cwd: root });
if (must('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root }) !== '') fail('the build changed tracked files');

// The staged tree, checked again: every @ahpd/* in it is a workspace copy (pnpm names those `@ahpd+<name>@file+…`).
const store = join(stage, 'node_modules', '.pnpm');
const foreignInStage = readdirSync(store).filter((name) => name.startsWith('@ahpd+') && !/^@ahpd\+[^@]+@file\+/.test(name));
if (foreignInStage.length > 0) fail(`the staged tree holds @ahpd packages that are not from the workspace: ${foreignInStage.join(', ')}`);

const version = `${JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).version}-beorn.${commit.slice(0, 8)}`;
// The installer accepts exactly one top-level folder, named after the archive without `.tar.gz` (@dev/5, @cto).
const top = `ahpd-${version}-${platform}-${arch}`;
const name = `${top}.tar.gz`;
const archive = join(out, name);
const mtime = must('git', ['show', '-s', '--format=%ct', commit], { cwd: root });
// pnpm's .bin shims and its own state files hold the absolute staging path: on a host they point nowhere, and they
// would publish this machine's folder names. The server starts from dist/main.js and needs none of them.
must(tar, [
  '--sort=name', `--mtime=@${mtime}`, '--owner=0', '--group=0', '--numeric-owner',
  '--exclude=node_modules/.bin', '--exclude=.modules.yaml', '--exclude=.pnpm-workspace-state-v1.json',
  '-C', out, '-cf', `${archive}.tar`, `--transform=s,^stage,${top},`, 'stage',
]);
must('gzip', ['-n', '-9', `${archive}.tar`]);
must('mv', [`${archive}.tar.gz`, archive]);
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');

const pins = {
  version,
  platform,
  arch,
  commit,
  built: versions,
  pins: {
    ahpd: { version, platform, arch, source: `${REPO}/releases/download/${tag}/${name}`, checksum: `sha256:${sha256}` },
  },
};
writeFileSync(join(out, `pins-${platform}-${arch}.json`), `${JSON.stringify(pins, null, 2)}\n`);
process.stdout.write(`pack-host-archive: ${name} sha256:${sha256}\n`);
