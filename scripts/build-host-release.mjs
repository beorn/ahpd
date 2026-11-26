#!/usr/bin/env node
// Cut one customer-host release: the six assets `hightea.ai/hosts/<tag>/<name>` answers for (#38280).
//
//   node scripts/build-host-release.mjs --commit <full sha> --tag hh-<issue>-<8hex> \
//     --hightea <hightea checkout> --hightea-sha <sha> --out <empty dir> [--publish]
//
// Two of the six already had their one producer: scripts/pack-host-archive.mjs writes
// ahpd-<version>-<target>.tar.gz and the complete pins-<target>.json, given a --pin-base that names the other three.
// This script builds those three, the deploy tarball the bootstrap runs, and writes the pin-base it just measured, so
// the pins file is still written only by the pack script (@cto c5038798) and every checksum in it is of bytes this run
// produced. --publish uploads all six to one immutable beorn/ahpd release; a release that exists is refused, never
// replaced (a fix is a new tag).
//
// The three artifacts the pack script cannot build:
//   bun-<target>                  the raw bun executable, never a zip: a stock Debian has no unzip (@dev/5 82d34a90).
//   supervisor-<version>-<target> process-compose, the supervisor the #38120 trial confirmed (@dev/6 scorecard); it is
//                                 the boot item's one command.
//   host-plugin-<version>.js      hightea's ahp-host plugin, bundled with no bare import (packages/cli/build.ts).
// Plus ahpd-deploy-<version>.tgz: @ahpd/deploy's bin bundled for bun and packed in npm's `package/…` layout, so
// `$BUN package/dist/bin.js` runs from an empty directory with no install step.
//
// Run it on the machine it builds for: the pack script takes this machine's native modules, never cross-built.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fail = (message) => {
  process.stderr.write(`build-host-release: refused: ${message}\n`);
  process.exit(2);
};
const note = (message) => process.stdout.write(`build-host-release: ${message}\n`);

const arg = (name, required = true) => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    if (required) fail(`--${name} is required`);
    return undefined;
  }
  return value;
};
const flag = (name) => process.argv.includes(`--${name}`);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) fail(`${command} ${args.join(' ')} could not start: ${result.error.message}`);
  return result;
};
const must = (command, args, options = {}) => {
  const result = run(command, args, options);
  if (result.status !== 0)
    fail(`${command} ${args.join(' ')} exited ${result.status}\n${(result.stdout ?? '').slice(-2000)}${(result.stderr ?? '').slice(-2000)}`);
  return (result.stdout ?? '').trim();
};

// The release contract, copied from hightea `packages/server/src/host-release-route.ts` on purpose: this script runs
// before any hightea checkout is guaranteed, so it cannot import it, and a name it gets wrong is a 404 for a customer.
const TAG = /^hh-[0-9]+-[0-9a-f]{8}$/u;
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const TARGET = String.raw`(?:linux|darwin)-(?:x64|arm64)`;
const CONTRACT = [
  new RegExp(`^ahpd-${VERSION}-${TARGET}\\.tar\\.gz$`, 'u'),
  new RegExp(`^pins-${TARGET}\\.json$`, 'u'),
  new RegExp(`^bun-${TARGET}$`, 'u'),
  new RegExp(`^ahpd-deploy-${VERSION}\\.tgz$`, 'u'),
  new RegExp(`^host-plugin-${VERSION}\\.js$`, 'u'),
  new RegExp(`^supervisor-${VERSION}-${TARGET}$`, 'u'),
];
const inContract = (name) => CONTRACT.some((pattern) => pattern.test(name));

const commit = arg('commit');
const tag = arg('tag');
const out = resolve(arg('out'));
const hightea = resolve(arg('hightea'));
const highteaSha = arg('hightea-sha');
const sourceBase = (arg('source-base', false) ?? 'https://hightea.ai/hosts').replace(/\/+$/u, '');
const runtimeVersion = arg('runtime', false) ?? '1.4.4';
const supervisorVersion = arg('supervisor', false) ?? '1.122.0';
const publish = flag('publish');
const allowDevPlugin = flag('allow-dev-plugin');

if (!TAG.test(tag)) fail(`--tag must read hh-<issue>-<8 hex>, got ${tag}`);
if (!/^[0-9a-f]{40}$/u.test(commit)) fail(`--commit must be a full 40-character sha, got ${commit}`);
if (!/^https:\/\/[^/\s]+/u.test(sourceBase)) fail(`--source-base must be an https URL, got ${sourceBase}`);
if (!/^\d+\.\d+\.\d+$/u.test(runtimeVersion)) fail(`--runtime must be an exact x.y.z bun version, got ${runtimeVersion}`);
if (!/^\d+\.\d+\.\d+$/u.test(supervisorVersion)) fail(`--supervisor must be an exact x.y.z process-compose version, got ${supervisorVersion}`);
if (existsSync(out) && readdirSync(out).length > 0) fail(`--out ${out} is not empty`);
if (!existsSync(hightea)) fail(`--hightea ${hightea} is not a directory`);

// The same commit-and-clean-tree rule the pack script enforces, said before two downloads and a build.
const root = must('git', ['rev-parse', '--show-toplevel']);
// The pack script refuses a dirty tree, and a fresh --out inside the checkout is untracked: either keep it outside the
// repository or in a path git already ignores.
if (out === root || out.startsWith(`${root}/`)) {
  const ignored = run('git', ['check-ignore', '-q', out], { cwd: root });
  if (ignored.status !== 0) fail(`--out ${out} is inside the checkout and not ignored by git; use a path outside it`);
}
const head = must('git', ['rev-parse', 'HEAD'], { cwd: root });
if (head !== commit) fail(`HEAD is ${head}, not --commit ${commit}; check out the commit first`);
if (must('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root }) !== '')
  fail('the tree is dirty; the pack script refuses a dirty tree and so does this run');

const platform = process.platform;
const arch = process.arch;
if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch))
  fail(`this machine is ${platform}-${arch}; releases are built for linux-x64 and darwin-arm64`);
const target = `${platform}-${arch}`;

mkdirSync(out, { recursive: true });
const work = join(out, '.work');
mkdirSync(work, { recursive: true });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const download = async (url, destination) => {
  const answer = await fetch(url, { redirect: 'follow' });
  if (!answer.ok) fail(`${url} answered ${String(answer.status)}`);
  writeFileSync(destination, Buffer.from(await answer.arrayBuffer()));
};

// 1. The runtime: bun's own release, checked against bun's published SHASUMS256.txt, then copied as the raw file the
// installer places with one chmod. The zip's top folder spells the target differently (aarch64, not arm64).
const bunArchive = platform === 'linux' ? `bun-linux-${arch === 'x64' ? 'x64' : 'aarch64'}` : `bun-darwin-aarch64`;
if (arch === 'x64' && platform === 'darwin') fail('bun has no darwin-x64 build in this script; the installer pins darwin-arm64 only');
const bunUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${runtimeVersion}/${bunArchive}.zip`;
const bunZip = join(work, 'bun.zip');
note(`runtime: ${bunUrl}`);
await download(bunUrl, bunZip);
const sums = await (await fetch(`https://github.com/oven-sh/bun/releases/download/bun-v${runtimeVersion}/SHASUMS256.txt`)).text();
const bunWanted = sums.split('\n').find((line) => line.endsWith(`  ${bunArchive}.zip`))?.split(' ')[0];
if (bunWanted === undefined) fail(`bun-v${runtimeVersion}'s SHASUMS256.txt names no ${bunArchive}.zip`);
if (sha256(bunZip) !== bunWanted) fail(`${bunArchive}.zip does not match bun's published sha256 ${bunWanted}`);
must('unzip', ['-q', '-o', bunZip, '-d', work]);
const bunBinary = join(work, bunArchive, 'bun');
if (!existsSync(bunBinary)) fail(`the bun zip has no ${bunArchive}/bun`);
const runtimeName = `bun-${target}`;
copyFileSync(bunBinary, join(out, runtimeName));
must('chmod', ['0755', join(out, runtimeName)]);

// 2. The supervisor: process-compose, checked against its own checksums file, unpacked from the tarball it ships as.
const pcGoos = platform === 'linux' ? 'linux' : 'darwin';
const pcGoarch = arch === 'x64' ? 'amd64' : 'arm64';
const pcAsset = `process-compose_${pcGoos}_${pcGoarch}.tar.gz`;
const pcBase = `https://github.com/f1bonacc1/process-compose/releases/download/v${supervisorVersion}`;
note(`supervisor: ${pcBase}/${pcAsset}`);
const pcTar = join(work, pcAsset);
await download(`${pcBase}/${pcAsset}`, pcTar);
const pcSums = await (await fetch(`${pcBase}/process-compose_checksums.txt`)).text();
const pcWanted = pcSums.split('\n').find((line) => line.endsWith(`  ${pcAsset}`))?.split(' ')[0];
if (pcWanted === undefined) fail(`process-compose v${supervisorVersion}'s checksums file names no ${pcAsset}`);
if (sha256(pcTar) !== pcWanted) fail(`${pcAsset} does not match process-compose's published sha256 ${pcWanted}`);
const pcDir = join(work, 'pc');
mkdirSync(pcDir, { recursive: true });
must('tar', ['-xzf', pcTar, '-C', pcDir]);
const pcBinary = join(pcDir, 'process-compose');
if (!existsSync(pcBinary)) fail(`${pcAsset} has no process-compose at its root`);
const supervisorName = `supervisor-${supervisorVersion}-${target}`;
copyFileSync(pcBinary, join(out, supervisorName));
must('chmod', ['0755', join(out, supervisorName)]);

// 3. The host plug-in: hightea's ahp-host bundle at one named sha, built the way packages/cli/build.ts builds it (no
// bare import, so the installed copy resolves nothing). A `-dev.<hash>` bundle is a build between cuts and refuses.
const highteaHead = must('git', ['rev-parse', 'HEAD'], { cwd: hightea });
if (highteaHead !== highteaSha) fail(`--hightea HEAD is ${highteaHead}, not --hightea-sha ${highteaSha}`);
if (!existsSync(join(hightea, 'node_modules'))) fail(`${hightea} has no node_modules; run its install before cutting a host release`);
note(`host plugin: ${hightea} at ${highteaSha}`);
must('bun', [join(hightea, 'packages/cli/build.ts')], { cwd: join(hightea, 'packages/cli') });
const pluginDirectory = join(hightea, 'packages/cli/dist/plugin');
const pluginManifest = JSON.parse(readFileSync(join(pluginDirectory, 'plugin.json'), 'utf8'));
if (typeof pluginManifest.version !== 'string' || !new RegExp(`^${VERSION}$`, 'u').test(pluginManifest.version))
  fail(`the host plug-in manifest names ${String(pluginManifest.version)}, not an exact version`);
if (/-dev\./u.test(pluginManifest.version) && !(allowDevPlugin && !publish))
  fail(`the host plug-in bundle is ${pluginManifest.version}: a build between cuts; cut the plugin release first, or use --allow-dev-plugin for a local proof that publishes nothing`);
const pluginName = `host-plugin-${pluginManifest.version}.js`;
copyFileSync(join(pluginDirectory, 'plugin.mjs'), join(out, pluginName));

// 4. The version every ahpd asset carries, the same formula scripts/pack-host-archive.mjs uses.
const version = `${JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).version}-beorn.${commit.slice(0, 8)}`;

// 5. The deploy tarball: one bun bundle at package/dist/bin.js, in npm's own layout, so nothing installs on the host.
const deployDir = join(work, 'deploy');
mkdirSync(join(deployDir, 'package/dist'), { recursive: true });
note('deploy: bundling @ahpd/deploy for bun');
must('bun', ['build', 'src/bin.ts', '--target=bun', '--outfile', join(deployDir, 'package/dist/bin.js')], {
  cwd: join(root, 'packages/deploy'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(
  join(deployDir, 'package/package.json'),
  `${JSON.stringify(
    {
      name: '@ahpd/host-install',
      version,
      private: true,
      type: 'module',
      bin: { 'ahpd-host-install': './dist/bin.js' },
    },
    null,
    2,
  )}\n`,
);
const deployName = `ahpd-deploy-${version}.tgz`;
const mtime = must('git', ['show', '-s', '--format=%ct', commit], { cwd: root });
must('tar', [
  '--sort=name', `--mtime=@${mtime}`, '--owner=0', '--group=0', '--numeric-owner',
  '-C', deployDir, '-cf', join(work, `${deployName}.tar`), 'package',
]);
must('gzip', ['-n', '-9', join(work, `${deployName}.tar`)]);
must('mv', [join(work, `${deployName}.tar.gz`), join(out, deployName)]);

// 6. The pin-base for the three above, measured from these bytes, then the pack script writes the four-pin file.
const pinBasePath = join(work, 'pin-base.json');
const pin = (name, extra = {}) => ({
  version: name === runtimeName ? runtimeVersion : name === supervisorName ? supervisorVersion : pluginManifest.version,
  ...extra,
  source: `${sourceBase}/${tag}/${name}`,
  checksum: `sha256:${sha256(join(out, name))}`,
});
writeFileSync(
  pinBasePath,
  `${JSON.stringify(
    {
      version,
      platform,
      pins: {
        runtime: { ...pin(runtimeName), platform, arch },
        hostPlugin: pin(pluginName),
        supervisor: { ...pin(supervisorName), platform, arch },
      },
    },
    null,
    2,
  )}\n`,
);

note('pack: ahpd archive and the complete pins file (scripts/pack-host-archive.mjs)');
const packOut = join(work, 'pack');
mkdirSync(packOut, { recursive: true });
must('node', [join(root, 'scripts/pack-host-archive.mjs'), '--commit', commit, '--tag', tag, '--source-base', sourceBase, '--pin-base', pinBasePath, '--out', packOut], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
});
const archiveName = `ahpd-${version}-${target}.tar.gz`;
const pinsName = `pins-${target}.json`;
copyFileSync(join(packOut, archiveName), join(out, archiveName));
copyFileSync(join(packOut, pinsName), join(out, pinsName));

// 7. The check @dev/6 will repeat against the published files: every pin's checksum is of the local bytes, and every
// name is one the host-release route answers. A mismatch here is before anything is uploaded.
const pins = JSON.parse(readFileSync(join(out, pinsName), 'utf8'));
const names = [archiveName, pinsName, runtimeName, deployName, pluginName, supervisorName];
for (const name of names) if (!inContract(name)) fail(`${name} is not a file the host-release route answers`);
const artifacts = {
  runtime: runtimeName,
  ahpd: archiveName,
  hostPlugin: pluginName,
  supervisor: supervisorName,
};
for (const key of ['runtime', 'ahpd', 'hostPlugin', 'supervisor']) {
  const one = pins.pins?.[key];
  const local = key === 'ahpd' ? `sha256:${sha256(join(out, archiveName))}` : `sha256:${sha256(join(out, artifacts[key]))}`;
  if (one?.checksum !== local) fail(`pins ${key} says ${String(one?.checksum)}, the bytes are ${local}`);
}
if (pins.version !== version) fail(`the pins file names ${String(pins.version)}, this cut is ${version}`);

rmSync(work, { recursive: true, force: true });
const lines = names.map((name) => `${sha256(join(out, name))}  ${name}`);
process.stdout.write(`${lines.join('\n')}\n`);
process.stdout.write(
  [
    '',
    'installer values for hightea site/public/hosts/install-ahpd-host.sh:',
    `  RELEASE_TAG="${tag}"`,
    `  DEPLOY_VERSION="${version}"`,
    `  DEPLOY_SHA256="${sha256(join(out, deployName))}"`,
    `  PINS_SHA512_${target.toUpperCase().replace('-', '_')}="${createHash('sha512').update(readFileSync(join(out, pinsName))).digest('hex')}"`,
    '',
  ].join('\n'),
);

if (publish) {
  note(`publish: beorn/ahpd release ${tag} (immutable; an existing tag is refused)`);
  const existing = run('gh', ['release', 'view', tag, '--repo', 'beorn/ahpd']);
  if (existing.status === 0) fail(`beorn/ahpd already has a release ${tag}; releases are immutable, cut a new tag`);
  must('gh', ['release', 'create', tag, '--repo', 'beorn/ahpd', '--title', `host ${tag}`, '--notes', `Customer host release ${version} for ${target}.`, ...names.map((name) => join(out, name))], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  note(`published ${tag}: ${names.join(', ')}`);
}
