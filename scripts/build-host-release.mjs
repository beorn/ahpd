#!/usr/bin/env node
// Cut one customer-host release: the six assets `hightea.ai/hosts/<tag>/<name>` answers for (#38280).
//
//   node scripts/build-host-release.mjs --commit <full sha> --tag hh-<issue>-<8hex> \
//     --hightea <hightea checkout> --hightea-sha <sha> --out <empty dir> [--publish]
//   node scripts/build-host-release.mjs --commit <full sha> --tag hh-<issue>-<8hex> \
//     --out <empty dir> --append [--shared <dir>]
//   node scripts/build-host-release.mjs --tag <tag> --finalize [--allow-single-target]
//
// Two of the six already had their one producer: scripts/pack-host-archive.mjs writes
// ahpd-<version>-<target>.tar.gz and the complete pins-<target>.json, given a --pin-base that names the other three.
// This script builds those three, the deploy tarball the bootstrap runs, and writes the pin-base it just measured, so
// the pins file is still written only by the pack script (@cto c5038798) and every checksum in it is of bytes this run
// produced.
//
// A release carries both machines but only Linux can be built here, so publishing is three steps (@dev/6 df76c0d1):
//   --publish   the first machine's run creates a DRAFT with all six of its assets.
//   --append    the second machine's run uploads only its own archive, pins, runtime and supervisor, refuses a name
//               already there (no --clobber), and takes the two shared assets — the deploy tarball and the host
//               plug-in — from the draft instead of rebuilding them: both pins files then name the same bytes by
//               construction. So --append needs no hightea checkout and no GNU tar (macOS's bsdtar refuses the flags
//               the deploy tarball is built with, and a Mac's bundle is not byte-identical to Linux's anyway).
//               --shared <dir> is for a machine with no GitHub client at all (a stock Mac): the directory holds the
//               first machine's two shared assets, the run writes its four here and prints the one gh command that
//               uploads them, for a machine that has one (@dev/5 2026-11-27).
//   --finalize  publishes the draft once both pins files are on it; --allow-single-target publishes with one and says
//               which machine is then not installable.
// An asset is never replaced; a fix is a new tag.
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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TAG, VERSION, ahpdVersion, appendPlan, assetNames, finalizeTargets, inContract, pinBase } from './host-release-assets.mjs';

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
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// Both checksum files are read from a URL now, so a 404 has to read as one rather than as "names no X".
const fetchText = async (url) => {
  const answer = await fetch(url, { redirect: 'follow' });
  if (!answer.ok) fail(`${url} answered ${String(answer.status)} ${answer.statusText}`);
  return answer.text();
};
const download = async (url, destination) => {
  note(`fetch ${url}`);
  const answer = await fetch(url, { redirect: 'follow' });
  if (!answer.ok) fail(`${url} answered ${String(answer.status)} ${answer.statusText}`);
  writeFileSync(destination, Buffer.from(await answer.arrayBuffer()));
};

/** The release as GitHub has it, or undefined when it has none. */
const releaseState = (name) => {
  const answer = run('gh', ['release', 'view', name, '--repo', 'beorn/ahpd', '--json', 'isDraft,assets']);
  if (answer.status !== 0) return undefined;
  return JSON.parse(answer.stdout);
};
const releaseAssetNames = (state) => new Set(state.assets.map((asset) => asset.name));
// A machine that cuts the other target may have no GitHub client at all (a stock Mac). --shared names a directory
// holding the first machine's two shared assets: the run reads them, and prints the upload command for a machine that
// does have one, instead of skipping the upload silently.
const sharedDir = arg('shared', false);
const downloadAsset = (name, directory) => {
  mkdirSync(directory, { recursive: true });
  if (sharedDir !== undefined) {
    const source = join(sharedDir, name);
    if (!existsSync(source)) fail('--shared ' + sharedDir + ' holds no ' + name + '; it must hold every shared asset --append reads');
    const destination = join(directory, name);
    copyFileSync(source, destination);
    return destination;
  }
  must('gh', ['release', 'download', tag, '--repo', 'beorn/ahpd', '--pattern', name, '--dir', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  return join(directory, name);
};

const tag = arg('tag');
const publish = flag('publish');
const append = flag('append');
const finalizeNow = flag('finalize');
const allowSingleTarget = flag('allow-single-target');
if (!TAG.test(tag)) fail(`--tag must read hh-<issue>-<8 hex>, got ${tag}`);
if ([publish, append, finalizeNow].filter(Boolean).length > 1) fail('--publish, --append and --finalize are one step each; pick one');

// --finalize needs no build: it reads the draft's own assets and publishes it.
if (finalizeNow) {
  const state = releaseState(tag);
  if (state === undefined) fail(`beorn/ahpd has no release ${tag} to finalize`);
  if (!state.isDraft) fail(`${tag} is already published; nothing to finalize`);
  const present = releaseAssetNames(state);
  const shared = ['ahpd-deploy-' , 'host-plugin-'].flatMap((prefix) => [...present].filter((name) => name.startsWith(prefix)));
  if (shared.length !== 2) fail(`${tag} is missing ${2 - shared.length} of its two shared assets (deploy tarball, host plug-in)`);
  const scratch = mkdtempSync(join(tmpdir(), 'ahpd-finalize-'));
  const targets = finalizeTargets(present);
  for (const one of targets) {
    const pinsName = `pins-${one}.json`;
    const pins = JSON.parse(readFileSync(downloadAsset(pinsName, scratch), 'utf8'));
    for (const key of ['ahpd', 'runtime', 'supervisor']) {
      const basename = String(pins.pins?.[key]?.source ?? '').split('/').pop();
      if (!present.has(basename)) fail(`${pinsName} names ${basename} for ${key}, and ${tag} does not carry it`);
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  if (targets.length === 0) fail(`${tag} carries no pins-<target>.json`);
  if (targets.length === 1 && !allowSingleTarget)
    fail(`${tag} carries only ${targets[0]}'s pins; run --append on the other machine, or --finalize --allow-single-target to publish one target`);
  must('gh', ['release', 'edit', tag, '--repo', 'beorn/ahpd', '--draft=false'], { stdio: ['ignore', 'inherit', 'inherit'] });
  note(`published ${tag}; installable: ${targets.join(', ')}${targets.length === 1 ? ' (the other machine has no installer pins yet)' : ''}`);
  process.exit(0);
}

const commit = arg('commit');
const out = resolve(arg('out'));
// --append takes the plug-in bytes from the draft, so only a run that builds it needs the hightea checkout.
const highteaArg = arg('hightea', !append);
const hightea = highteaArg === undefined ? undefined : resolve(highteaArg);
const highteaSha = arg('hightea-sha', !append);
const sourceBase = (arg('source-base', false) ?? 'https://hightea.ai/hosts').replace(/\/+$/u, '');
const runtimeVersion = arg('runtime', false) ?? '1.4.4';
const supervisorVersion = arg('supervisor', false) ?? '1.122.0';

if (!/^[0-9a-f]{40}$/u.test(commit)) fail(`--commit must be a full 40-character sha, got ${commit}`);
// A tag names its build: the eight hex are this commit, or an operator cannot tell which ahpd a tag carries.
if (tag.slice(-8) !== commit.slice(0, 8)) fail(`--tag ends in ${tag.slice(-8)}, but --commit is ${commit.slice(0, 8)}; a tag names its ahpd build`);
if (!/^https:\/\/[^/\s]+/u.test(sourceBase)) fail(`--source-base must be an https URL, got ${sourceBase}`);
if (!/^\d+\.\d+\.\d+$/u.test(runtimeVersion)) fail(`--runtime must be an exact x.y.z bun version, got ${runtimeVersion}`);
if (!/^\d+\.\d+\.\d+$/u.test(supervisorVersion)) fail(`--supervisor must be an exact x.y.z process-compose version, got ${supervisorVersion}`);
if (existsSync(out) && readdirSync(out).length > 0) fail(`--out ${out} is not empty`);
if (hightea !== undefined && !existsSync(hightea)) fail(`--hightea ${hightea} is not a directory`);

// The same commit-and-clean-tree rule the pack script enforces, said before two downloads and a build. The out folder
// is inside the checkout only when git already ignores it: a fresh one would make the tree dirty.
const root = must('git', ['rev-parse', '--show-toplevel']);
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
  fail(`this machine is ${platform}-${arch}; releases are built for linux-x64, darwin-arm64 and darwin-x64`);
const target = `${platform}-${arch}`;

mkdirSync(out, { recursive: true });
const work = join(out, '.work');
mkdirSync(work, { recursive: true });

// --append never builds the two assets both machines must publish; it takes them from the draft. A draft made by
// --publish carries all six, so a shared name that is missing or doubled means this is not that draft.
let draftPresent;
if (append) {
  if (sharedDir !== undefined) {
    if (!existsSync(sharedDir)) fail('--shared ' + sharedDir + ' is not a directory');
    draftPresent = new Set(readdirSync(sharedDir));
    note('shared assets read from ' + sharedDir + '; this run prints its upload command instead of using a GitHub client');
  } else {
    const state = releaseState(tag);
    if (state === undefined) fail(`--append needs a draft release ${tag}; run --publish on the first machine`);
    if (!state.isDraft) fail(`${tag} is already published; release assets are immutable, cut a new tag`);
    draftPresent = releaseAssetNames(state);
  }
}
const sharedOnDraft = (prefix) => {
  const found = [...draftPresent].filter((name) => name.startsWith(prefix));
  if (found.length !== 1) fail(`draft ${tag} carries ${String(found.length)} ${prefix}… assets; --publish uploads exactly one`);
  return found[0];
};

// 1. The runtime: bun's own release, checked against bun's published SHASUMS256.txt, then copied as the raw file the
// installer places with one chmod. The zip's top folder spells the target differently (aarch64, not arm64).
const bunArchive = `bun-${platform}-${arch === 'x64' ? 'x64' : 'aarch64'}`;
const bunUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${runtimeVersion}/${bunArchive}.zip`;
const bunZip = join(work, 'bun.zip');
await download(bunUrl, bunZip);
const sums = await fetchText(`https://github.com/oven-sh/bun/releases/download/bun-v${runtimeVersion}/SHASUMS256.txt`);
const bunWanted = sums.split('\n').find((line) => line.endsWith(`  ${bunArchive}.zip`))?.split(' ')[0];
if (bunWanted === undefined) fail(`bun-v${runtimeVersion}'s SHASUMS256.txt names no ${bunArchive}.zip`);
if (sha256(bunZip) !== bunWanted) fail(`${bunArchive}.zip does not match bun's published sha256 ${bunWanted}`);
must('unzip', ['-q', '-o', bunZip, '-d', work]);
const bunBinary = join(work, bunArchive, 'bun');
if (!existsSync(bunBinary)) fail(`the bun zip has no ${bunArchive}/bun`);
const names = { runtime: `bun-${target}` };
copyFileSync(bunBinary, join(out, names.runtime));
must('chmod', ['0755', join(out, names.runtime)]);
note(`runtime ${must(join(out, names.runtime), ['--version'])}`);

// 2. The supervisor: process-compose, checked against its own checksums file, unpacked from the tarball it ships as.
const pcGoos = platform === 'linux' ? 'linux' : 'darwin';
const pcGoarch = arch === 'x64' ? 'amd64' : 'arm64';
const pcAsset = `process-compose_${pcGoos}_${pcGoarch}.tar.gz`;
const pcBase = `https://github.com/f1bonacc1/process-compose/releases/download/v${supervisorVersion}`;
const pcTar = join(work, pcAsset);
await download(`${pcBase}/${pcAsset}`, pcTar);
const pcSums = await fetchText(`${pcBase}/process-compose_checksums.txt`);
const pcWanted = pcSums.split('\n').find((line) => line.endsWith(`  ${pcAsset}`))?.split(' ')[0];
if (pcWanted === undefined) fail(`process-compose v${supervisorVersion}'s checksums file names no ${pcAsset}`);
if (sha256(pcTar) !== pcWanted) fail(`${pcAsset} does not match process-compose's published sha256 ${pcWanted}`);
const pcDir = join(work, 'pc');
mkdirSync(pcDir, { recursive: true });
must('tar', ['-xzf', pcTar, '-C', pcDir]);
const pcBinary = join(pcDir, 'process-compose');
if (!existsSync(pcBinary)) fail(`${pcAsset} has no process-compose at its root`);
names.supervisor = `supervisor-${supervisorVersion}-${target}`;
copyFileSync(pcBinary, join(out, names.supervisor));
must('chmod', ['0755', join(out, names.supervisor)]);

// 3. The host plug-in. On --publish: hightea's ahp-host bundle at one named, clean sha, built the way
// packages/cli/build.ts builds it (no bare import, so the installed copy resolves nothing). `dist` is gitignored, so
// the build cannot dirty the tree. On --append the draft's own plug-in bytes, untouched.
let pluginVersion;
if (append) {
  names.plugin = sharedOnDraft('host-plugin-');
  pluginVersion = names.plugin.slice('host-plugin-'.length, -'.js'.length);
  if (!new RegExp(`^${VERSION}$`, 'u').test(pluginVersion))
    fail(`the draft carries ${names.plugin}, whose name is not an exact version`);
  downloadAsset(names.plugin, out);
  note(`host plugin from the draft: ${names.plugin} (${sha256(join(out, names.plugin))})`);
} else {
  const highteaHead = must('git', ['rev-parse', 'HEAD'], { cwd: hightea });
  if (highteaHead !== highteaSha) fail(`--hightea HEAD is ${highteaHead}, not --hightea-sha ${highteaSha}`);
  if (must('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: hightea }) !== '')
    fail(`--hightea ${hightea} is dirty; uncommitted plugin code must not be released under ${highteaSha}`);
  if (!existsSync(join(hightea, 'node_modules'))) fail(`${hightea} has no node_modules; run its install before cutting a host release`);
  note(`host plugin: ${hightea} at ${highteaSha}`);
  must('bun', [join(hightea, 'packages/cli/build.ts')], { cwd: join(hightea, 'packages/cli') });
  const pluginDirectory = join(hightea, 'packages/cli/dist/plugin');
  const pluginManifest = JSON.parse(readFileSync(join(pluginDirectory, 'plugin.json'), 'utf8'));
  if (typeof pluginManifest.version !== 'string' || !new RegExp(`^${VERSION}$`, 'u').test(pluginManifest.version))
    fail(`the host plug-in manifest names ${String(pluginManifest.version)}, not an exact version`);
  if (/-dev\./u.test(pluginManifest.version) && !(flag('allow-dev-plugin') && !publish))
    fail(`the host plug-in bundle is ${pluginManifest.version}: a build between cuts; cut the plugin release first, or use --allow-dev-plugin for a local proof that publishes nothing`);
  pluginVersion = pluginManifest.version;
  names.plugin = `host-plugin-${pluginVersion}.js`;
  copyFileSync(join(pluginDirectory, 'plugin.mjs'), join(out, names.plugin));
}

// 4. The version every ahpd asset carries, the same formula scripts/pack-host-archive.mjs uses.
const version = ahpdVersion(JSON.parse(readFileSync(join(root, 'packages/server/package.json'), 'utf8')).version, commit);

// 5. The deploy tarball: one bun bundle at package/dist/bin.js, in npm's own layout, so nothing installs on the host.
// It is built with the runtime this release ships, not whatever bun is on PATH, and its whole use is checked below.
// On --append it is the draft's tarball, untouched: the pins here must name the bytes the first machine built.
names.deploy = `ahpd-deploy-${version}.tgz`;
if (append) {
  const onDraft = sharedOnDraft('ahpd-deploy-');
  if (onDraft !== names.deploy)
    fail(`the draft's deploy tarball is ${onDraft}, this cut is ${version}; both machines cut the same --commit`);
  downloadAsset(names.deploy, out);
  note(`deploy tarball from the draft: ${names.deploy} (${sha256(join(out, names.deploy))})`);
} else {
  const deployDir = join(work, 'deploy');
  mkdirSync(join(deployDir, 'package/dist'), { recursive: true });
  note('deploy: bundling @ahpd/deploy for bun');
  must(join(out, names.runtime), ['build', 'src/bin.ts', '--target=bun', '--outfile', join(deployDir, 'package/dist/bin.js')], {
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
  const mtime = must('git', ['show', '-s', '--format=%ct', commit], { cwd: root });
  must('tar', [
    '--sort=name', `--mtime=@${mtime}`, '--owner=0', '--group=0', '--numeric-owner',
    '-C', deployDir, '-cf', join(work, `${names.deploy}.tar`), 'package',
  ]);
  must('gzip', ['-n', '-9', join(work, `${names.deploy}.tar`)]);
  must('mv', [join(work, `${names.deploy}.tar.gz`), join(out, names.deploy)]);
}

// 6. The pin-base for the three above, measured from these bytes, then the pack script writes the four-pin file.
const pinBasePath = join(work, 'pin-base.json');
const checksums = Object.fromEntries([names.runtime, names.plugin, names.supervisor].map((name) => [name, sha256(join(out, name))]));
writeFileSync(
  pinBasePath,
  `${JSON.stringify(
    pinBase({
      version,
      platform,
      arch,
      tag,
      sourceBase,
      names,
      versions: { runtime: runtimeVersion, hostPlugin: pluginVersion, supervisor: supervisorVersion },
      checksums,
    }),
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
const all = assetNames({ version, runtimeVersion, supervisorVersion, pluginVersion, target });
const archiveName = all.archive;
const pinsName = all.pins;
copyFileSync(join(packOut, archiveName), join(out, archiveName));
copyFileSync(join(packOut, pinsName), join(out, pinsName));

// 7. The check @dev/6 repeated against the published files: every pin's checksum is of the local bytes, and every name
// is one the host-release route answers. A mismatch here is before anything is uploaded.
const pins = JSON.parse(readFileSync(join(out, pinsName), 'utf8'));
const released = [archiveName, pinsName, names.runtime, names.deploy, names.plugin, names.supervisor];
for (const name of released) if (!inContract(name)) fail(`${name} is not a file the host-release route answers`);
const artifacts = {
  runtime: names.runtime,
  ahpd: archiveName,
  hostPlugin: names.plugin,
  supervisor: names.supervisor,
};
for (const key of ['runtime', 'ahpd', 'hostPlugin', 'supervisor']) {
  const one = pins.pins?.[key];
  const local = key === 'ahpd' ? `sha256:${sha256(join(out, archiveName))}` : `sha256:${sha256(join(out, artifacts[key]))}`;
  if (one?.checksum !== local) fail(`pins ${key} says ${String(one?.checksum)}, the bytes are ${local}`);
}
if (pins.version !== version) fail(`the pins file names ${String(pins.version)}, this cut is ${version}`);

// 8. The tarball is run the way the bootstrap runs it: unpacked, from an empty directory, with this release's runtime
// and pins. `--plan` fetches nothing, so this proves the layout, the bundle and the pins before anything is uploaded.
const checkRoot = join(work, 'check');
const checkRun = join(checkRoot, 'run');
const extract = join(checkRoot, 'deploy');
mkdirSync(checkRun, { recursive: true });
mkdirSync(extract, { recursive: true });
must('tar', ['-xzf', join(out, names.deploy), '-C', extract]);
const plan = run(join(out, names.runtime), [join(extract, 'package/dist/bin.js'), '--pins', join(out, pinsName), '--plan', '--home', join(checkRoot, 'home')], { cwd: checkRun });
if (plan.status !== 0)
  fail(`the deploy tarball did not run with this release's runtime: ${(plan.stdout ?? '').slice(-1000)}${(plan.stderr ?? '').slice(-1000)}`);
if (!/uninstall removes \d+ entries/u.test(plan.stdout ?? '')) fail('the deploy tarball printed no install plan; the bootstrap would have run nothing useful');
note('checked: the tarball runs from an empty directory and prints the plan');

process.stdout.write(`${released.map((name) => `${sha256(join(out, name))}  ${name}`).join('\n')}\n`);
process.stdout.write(
  [
    '',
    'installer values for hightea site/public/hosts/install-ahpd-host.sh:',
    `  RELEASE_TAG="${tag}"`,
    `  DEPLOY_VERSION="${version}"`,
    `  DEPLOY_SHA256="${sha256(join(out, names.deploy))}"`,
    `  PINS_SHA512_${target.toUpperCase().replace('-', '_')}="${createHash('sha512').update(readFileSync(join(out, pinsName))).digest('hex')}"`,
    '',
  ].join('\n'),
);

if (publish || append) {
  const shared = [names.deploy, names.plugin];
  const mine = [archiveName, pinsName, names.runtime, names.supervisor];
  if (publish) {
    const state = releaseState(tag);
    if (state !== undefined)
      fail(`${tag} already exists as a ${state.isDraft ? 'draft' : 'published release'}; run --append on the other machine, or cut a new tag`);
    note(`publish: creating DRAFT ${tag} with this machine's six assets (--append the other, then --finalize)`);
    must('gh', ['release', 'create', tag, '--repo', 'beorn/ahpd', '--draft', '--title', `host ${tag}`, '--notes', `Customer host release ${version}. Targets are appended by the same builder; --finalize publishes it.`, ...released.map((name) => join(out, name))], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    note(`drafted ${tag}: ${released.join(', ')}`);
  } else {
    // Both maps are the bytes this run placed in out/ from the draft, so the shared half of the plan is a self-check:
    // the plug-in and tarball the new pins will name are the ones the release already carries.
    const sharedChecksums = Object.fromEntries(shared.map((name) => [name, sha256(join(out, name))]));
    const plan = appendPlan({
      onRelease: draftPresent,
      shared,
      mine,
      localChecksums: sharedChecksums,
      remoteChecksums: sharedChecksums,
    });
    if (!plan.ok) fail(plan.refusal);
    const upload = plan.upload;
    if (sharedDir !== undefined) {
      process.stdout.write(['gh', 'release', 'upload', tag, '--repo', 'beorn/ahpd', ...upload.map((name) => join(out, name))].join(' ') + '\n');
      note('append: ' + upload.join(', ') + ' written to ' + out + '; upload them with the command above, then --finalize');
    } else {
    note(`append: uploading ${upload.join(', ')} to DRAFT ${tag}`);
    must('gh', ['release', 'upload', tag, '--repo', 'beorn/ahpd', ...upload.map((name) => join(out, name))], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    note(`appended ${tag}: ${upload.join(', ')}`);
    }
  }
}

rmSync(work, { recursive: true, force: true });
