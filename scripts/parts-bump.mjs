#!/usr/bin/env node
/*
 * A bump of the parts file, proposed rather than made.
 *
 * The ACP Registry is the feed: an entry is matched by id, and an npm part the
 * registry does not carry is asked about itself. An archive the feed ships a
 * sum for takes that sum, and one it does not is downloaded and hashed here,
 * because a part is built only when its archive matches what is written down.
 * The ahpd part follows the higher of the `latest` and `next` versions npm
 * serves of `@ahpd/server`, which is the last release, a candidate included.
 *
 * A part that moves and installs npm packages has its lock written again, in
 * `parts/<id>` beside the parts file, which is what the part is installed from.
 *
 *   node scripts/parts-bump.mjs                  # bump what moved
 *   node scripts/parts-bump.mjs --dry-run        # print the moves, write nothing
 *   node scripts/parts-bump.mjs --registry <file>
 *   node scripts/parts-bump.mjs --locks          # write every part's lock again, bump nothing
 *   node scripts/parts-bump.mjs --release <folder>
 *
 * `--release` is the release run's: the folder holds the packed packages of the
 * ahpd part, which npm does not serve yet, and the part's version and locks are
 * written from them as npm will serve them. It moves no other part, and what it
 * writes is packed into `@ahpd/computer` and never committed.
 *
 * A part that cannot be resolved is skipped by name and the rest of the file
 * still lands, because one archive that 404s is not thirteen agents down.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const FILE = fileURLToPath(new URL('../packages/computer/images/versions.json', import.meta.url));

/** The two platforms a part is built for, and the registry's name for each. */
const PLATFORMS = { 'linux-x64': 'linux-x86_64', 'linux-arm64': 'linux-aarch64' };

/**
 * An exact version, a download url and a sha256, as the parts file has to hold
 * them, copied from `packages/computer/src/parts.ts` rather than imported.
 *
 * Copied because this runs from `parts-bump.yml`, which installs nothing and
 * builds nothing, so there is no built module to import - and a value this file
 * writes without checking is one the next start refuses the whole file for.
 */
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?(?:\+[0-9A-Za-z.]+)?$/;
const URL_SAFE = /^https:\/\/[A-Za-z0-9._~\/%+-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const locksOnly = argv.includes('--locks');
const registryAt = argv.indexOf('--registry');
const releaseAt = argv.indexOf('--release');
const source = registryAt === -1 ? undefined : argv[registryAt + 1];

/** The flags npm writes a lock with, resolving and running nothing. */
const LOCK_FLAGS = ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'];

/**
 * The packages a part's lock pins, by name: each npm package at the part's
 * version, or at its own where the entry is written `<package>@<version>`,
 * and for the ahpd part `@ahpd/sdk` and `@ahpd/server` at its version, as
 * `packages/computer/src/parts.ts` reads an entry.
 */
const dependenciesOf = (part) => {
  if (part.kind === 'ahpd') return { '@ahpd/sdk': part.version, '@ahpd/server': part.version };
  return Object.fromEntries((part.packages ?? []).map((one) => {
    const at = one.lastIndexOf('@');
    return at > 0 ? [one.slice(0, at), one.slice(at + 1)] : [one, part.version];
  }));
};

/** What the ahpd part's plugins are locked as: each at the part's version, with the sdk they peer beside them. */
const pluginsOf = (part) =>
  Object.fromEntries(['@ahpd/sdk', ...(part.plugins ?? [])].map((one) => [one, part.version]));

/**
 * Each lock a part has: its folder under `parts`, the packages it pins, and
 * npm's own flags for it. The ahpd part's plugins have one of their own, and
 * check no plugin's peer range against another's, as `ahpd plugin install`
 * installs into a plugin root.
 */
const locksOf = (part) => [
  { folder: part.id, name: `ahpd-part-${part.id}`, dependencies: dependenciesOf(part), flags: [] },
  ...(part.kind !== 'ahpd' || part.plugins === undefined ? [] : [{
    folder: join(part.id, 'plugins'), name: `ahpd-part-${part.id}-plugins`, dependencies: pluginsOf(part), flags: ['--legacy-peer-deps'],
  }]),
];

/** npm's lock of `manifest`, written beside it in `dir`. */
const npmLock = async (dir, manifest, flags) => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const ran = spawnSync('npm', [...LOCK_FLAGS, ...flags], { cwd: dir, encoding: 'utf8' });
  if (ran.status !== 0) throw new Error((ran.stderr ?? '').trim().split('\n').at(-1) || `exit ${ran.status}`);
};

/**
 * One part's `package.json` and `package-lock.json`, in `parts/<id>` beside the
 * parts file, and for the ahpd part's plugins the two in `parts/<id>/plugins`: the packages it pins, then npm's lock of the graph they resolve
 * to, made without installing or running anything, as VS Code refreshes an
 * agent SDK's lock.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/build/agent-sdk/README.md#L88-L94
 */
const lock = async (part) => {
  for (const one of locksOf(part)) {
    try {
      await npmLock(join(dirname(FILE), 'parts', one.folder), { name: one.name, private: true, dependencies: one.dependencies }, one.flags);
    } catch (error) {
      throw new Error(`npm did not lock ${one.folder}: ${error.message}`);
    }
  }
};

/** Whether a part installs npm packages, which is what has a lock. */
const lockable = (part) => part.kind === 'ahpd' || part.packages !== undefined;

/** The registry, by id. A fetch that fails is a failed run, not a quiet one. */
const entriesOf = async () => {
  const body = source === undefined
    ? await (await fetch(REGISTRY)).text()
    : await readFile(source, 'utf8');
  return new Map((JSON.parse(body).agents ?? []).map((entry) => [entry.id, entry]));
};

/** What npm says a package is at, which is the only feed an unlisted part has. */
const npmVersion = (name) => {
  const asked = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8' });
  return asked.status === 0 ? asked.stdout.trim() : undefined;
};

/**
 * The versions npm serves a package under its `latest` and `next` tags, or
 * `undefined` when npm answers nothing it can read. npm 12 answers a `--json`
 * view as an array of one object, and earlier npm as the object itself.
 */
const npmChannels = (name) => {
  const asked = spawnSync('npm', ['view', name, 'dist-tags', '--json'], { encoding: 'utf8' });
  if (asked.status !== 0) return undefined;
  try {
    const said = JSON.parse(asked.stdout);
    const tags = Array.isArray(said) ? said[0] : said;
    return tags !== null && typeof tags === 'object' ? { latest: tags.latest, next: tags.next } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * How two exact versions order, as semver orders them: `1` when `one` is the
 * higher, `-1` when `two` is, `0` when they are the same version. A release is
 * higher than its own prerelease (`0.15.0` follows `0.15.0-rc.2`), and build
 * metadata does not count.
 * https://semver.org/#spec-item-11
 */
const orderOf = (one, two) => {
  const read = (version) => {
    const [core, ...tag] = String(version).replace(/^v/, '').split('+')[0].split('-');
    return { core: core.split('.').map(Number), pre: tag.length === 0 ? [] : tag.join('-').split('.') };
  };
  const a = read(one);
  const b = read(two);
  for (let at = 0; at < 3; at++) {
    if ((a.core[at] ?? 0) !== (b.core[at] ?? 0)) return (a.core[at] ?? 0) > (b.core[at] ?? 0) ? 1 : -1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) {
    if (a.pre.length === b.pre.length) return 0;
    return a.pre.length === 0 ? 1 : -1;
  }
  return tagOrder(a.pre, b.pre);
};

/**
 * How two prerelease tags of the same core order, as semver orders them, each
 * given as its dot-separated identifiers: `1` when `one` is the higher, `-1`
 * when `two` is, `0` when they are the same. A number is lower than a word, and
 * a tag that is a prefix of the other is the lower one (`rc` before `rc.1`).
 * https://semver.org/#spec-item-11
 */
const tagOrder = (one, two) => {
  for (let at = 0; at < Math.max(one.length, two.length); at++) {
    const x = one[at];
    const y = two[at];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numbers = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (numbers[0] && numbers[1]) return Number(x) > Number(y) ? 1 : -1;
    if (numbers[0] !== numbers[1]) return numbers[0] ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
};

/** The sum of the file at a url, for an archive the registry ships without one. */
const shaOf = async (url) => {
  let bytes;
  try {
    const said = await fetch(url);
    if (!said.ok) throw new Error(`HTTP ${said.status}`);
    bytes = await said.arrayBuffer();
  } catch (error) {
    throw new Error(`${url} could not be read: ${error.message}`);
  }
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
};

/**
 * Whether `next` is a move worth proposing.
 *
 * Dotted halves compare segment by segment, a missing segment is the older one
 * (`1.2` is not newer than `1.2.1`), and a release is newer than the prerelease
 * before it (`1.2.0` follows `1.2.0-rc.1`). A segment that is not a number
 * compares as a string, which is why the version is put to `EXACT` before it is
 * written: a feed that answers `latest` compares as newer than any version.
 *
 * A part on a release never moves to a prerelease. A prerelease is a version
 * somebody is still working on, and moving to one would make every host that
 * took the bump build an agent that may still change under the same version -
 * the release it is a candidate for proposes itself a while later. A part that
 * is already on a prerelease was put there by hand, so it follows that line: to
 * a newer prerelease, or to a release. Two prereleases of one core compare by
 * their tags (`0.2.0-rc.3` follows `0.2.0-rc.2`).
 */
const newerThan = (next, held) => {
  const [one, tagOne] = halvesOf(next);
  const [two, tagTwo] = halvesOf(held);
  if (prereleaseRefused(next, held)) return false;
  if (one !== two) {
    const left = one.split('.');
    const right = two.split('.');
    for (let at = 0; at < Math.max(left.length, right.length); at++) {
      const a = left[at];
      const b = right[at];
      if (a === b) continue;
      if (a === undefined) return false;
      if (b === undefined) return true;
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return a > b;
      return Number(a) > Number(b);
    }
  }
  if (tagOne === '') return tagTwo !== '';
  return tagOrder(tagOne.split('.'), tagTwo.split('.')) > 0;
};

/** A version's core and its prerelease tag, the tag empty for a release. */
const halvesOf = (version) => {
  const plain = String(version).replace(/^v/, '');
  const at = plain.indexOf('-');
  return at < 0 ? [plain, ''] : [plain.slice(0, at), plain.slice(at + 1)];
};

/** Whether `next` is a prerelease offered to a part on a release, which never moves to one. */
const prereleaseRefused = (next, held) => halvesOf(next)[1] !== '' && halvesOf(held)[1] === '';

/** What one part moves to, or the line that says why it does not. */
const bumpOf = async (part, entries) => {
  const entry = entries.get(part.id);

  /*
   * The committed ahpd part is what a checkout runs: the last release npm
   * serves. A release writes its own version over it with `--release`, since
   * npm serves that only after it is approved, after the tag run. Its `next` counts, unlike any other
   * part's prerelease, because a release candidate of ahpd is a version npm
   * serves and a host on that channel runs.
   */
  if (part.kind === 'ahpd') {
    const channels = npmChannels('@ahpd/server');
    const served = [channels?.latest, channels?.next].filter((one) => typeof one === 'string' && EXACT.test(one));
    if (served.length === 0) return { skipped: 'npm names no latest or next version of @ahpd/server' };
    const version = served.reduce((one, two) => (orderOf(two, one) > 0 ? two : one));
    if (orderOf(version, part.version) <= 0) return { skipped: `npm has ${version}, which is not newer than ${part.version}` };
    return { version };
  }
  if (part.kind === 'node') return { skipped: 'node is not fed by the registry or by npm; move it by hand' };

  if (part.kind === 'npm') {
    const version = entry?.version ?? npmVersion(part.packages[0]);
    if (version === undefined) return { skipped: `npm says nothing about ${part.packages[0]}` };
    if (prereleaseRefused(version, part.version)) {
      return { skipped: `the feed has ${version}, a prerelease, and ${part.id} is on a release` };
    }
    if (!newerThan(version, part.version)) {
      return { skipped: `the feed has ${version}, which is not newer than ${part.version}` };
    }
    if (!EXACT.test(version)) return { skipped: `the feed has ${version}, which is not one version` };
    return { version };
  }

  if (part.kind !== 'archive') return { skipped: `a ${part.kind} part is fed by nothing here` };
  if (entry === undefined) return { skipped: 'not in the registry, and its url is a template rather than a feed' };
  if (prereleaseRefused(entry.version, part.version)) {
    return { skipped: `the registry has ${entry.version}, a prerelease, and ${part.id} is on a release` };
  }
  if (!newerThan(entry.version, part.version)) {
    return { skipped: `the registry has ${entry.version}, which is not newer than ${part.version}` };
  }
  if (!EXACT.test(entry.version)) {
    return { skipped: `the registry has ${entry.version}, which is not one version` };
  }

  const archives = {};
  for (const [platform, build] of Object.entries(PLATFORMS)) {
    const binary = entry.distribution?.binary?.[build];
    if (binary?.archive === undefined) return { skipped: `the registry has no ${build} build of ${entry.version}` };
    if (!URL_SAFE.test(binary.archive)) {
      return { skipped: `the ${build} archive is ${binary.archive}, which is not a plain https url` };
    }
    const sha256 = binary.sha256 ?? await shaOf(binary.archive);
    if (!SHA256.test(sha256)) {
      return { skipped: `the ${build} archive's sha256 is ${sha256}, which is not 64 hex digits` };
    }
    archives[platform] = { url: binary.archive, sha256 };
  }
  return { version: entry.version, archives };
};

/** A block of plain strings joins back onto one line only while it fits on one. */
const oneLine = (whole, items) => {
  const braces = whole[0] === '{';
  const flat = `${braces ? '{ ' : '['}${items.replace(/\s*,\s*/g, ', ')}${braces ? ' }' : ']'}`;
  return flat.length <= 72 ? flat : whole;
};

/**
 * The file, as it is written: two-space JSON, with a short block of strings on
 * one line, so a bump's diff is the versions and the sums and not the whole
 * file. A block too long for one line stays expanded, which is what an
 * archive entry is.
 */
const layout = (parts) => `${JSON.stringify(parts, null, 2)
  .replace(/\[\s+("[^"]*"(?:\s*,\s*"[^"]*")*)\s+\]/g, oneLine)
  .replace(/\{\s+("[^"]*":\s*"[^"]*"(?:\s*,\s*"[^"]*":\s*"[^"]*")*)\s+\}/g, oneLine)}\n`;

const parts = JSON.parse(await readFile(FILE, 'utf8'));

/**
 * Each of `which` locked, a line apiece, and whether every one was: a lock npm
 * could not write is a failed run, since the part is installed from it.
 */
const lockAll = async (which) => {
  let locked = true;
  for (const part of which.filter(lockable)) {
    try {
      await lock(part);
      console.log(`locked ${part.id}`);
    } catch (error) {
      console.log(`not locked ${part.id}: ${error.message}`);
      locked = false;
    }
  }
  return locked;
};

/** The packed tarball of each package the ahpd part pins, by name, every one at the same version. */
const packedIn = async (folder, part) => {
  const names = [...new Set(locksOf(part).flatMap((one) => Object.keys(one.dependencies)))];
  const files = await readdir(folder);
  const packed = new Map();
  for (const name of names) {
    const stem = `${name.slice(1).replace('/', '-')}-`;
    const found = files.filter((one) => one.startsWith(stem) && one.endsWith('.tgz') && EXACT.test(one.slice(stem.length, -'.tgz'.length)));
    if (found.length !== 1) throw new Error(`${folder} holds ${found.length === 0 ? 'no' : 'more than one'} tarball of ${name}`);
    packed.set(name, { file: resolve(folder, found[0]), version: found[0].slice(stem.length, -'.tgz'.length) });
  }
  const versions = [...new Set([...packed.values()].map((one) => one.version))];
  if (versions.length !== 1) throw new Error(`${folder} holds packages of more than one version: ${versions.join(', ')}`);
  return { version: versions[0], packed };
};

/**
 * One lock of the ahpd part, made from the tarballs and written as npm will
 * serve them: each tarball's `resolved` is its address in the registry, its
 * integrity stays the hash of the tarball, and the dependencies are versions.
 * A lock that does not hold a tarball by its own hash, or still names a file,
 * is refused, since no host could install from it.
 */
const releaseLock = async (dir, one, packed) => {
  const files = Object.fromEntries(Object.keys(one.dependencies).map((name) => [name, `file:${packed.get(name).file}`]));
  await npmLock(dir, { name: one.name, private: true, dependencies: files }, one.flags);
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'));
  for (const [at, held] of Object.entries(lock.packages ?? {})) {
    if (at === '') held.dependencies = one.dependencies;
    if (!held.resolved?.startsWith('file:')) continue;
    const name = at.slice(at.lastIndexOf('node_modules/') + 'node_modules/'.length);
    held.resolved = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${held.version}.tgz`;
  }
  for (const name of Object.keys(one.dependencies)) {
    const integrity = `sha512-${createHash('sha512').update(await readFile(packed.get(name).file)).digest('base64')}`;
    const held = lock.packages?.[`node_modules/${name}`];
    if (held?.integrity !== integrity || held?.version !== packed.get(name).version) {
      throw new Error(`the lock of ${one.folder} does not hold ${packed.get(name).file}`);
    }
  }
  const text = `${JSON.stringify(lock, null, 2)}\n`;
  if (text.includes('file:')) throw new Error(`the lock of ${one.folder} still names a file`);
  return { manifest: `${JSON.stringify({ name: one.name, private: true, dependencies: one.dependencies }, null, 2)}\n`, lock: text };
};

/** The release's version and locks of the ahpd part, written once every lock is made. */
const release = async (folder) => {
  const part = parts.find((one) => one.kind === 'ahpd');
  if (part === undefined) throw new Error(`${FILE} names no ahpd part`);
  const { version, packed } = await packedIn(folder, part);
  part.version = version;
  const scratch = await mkdtemp(join(tmpdir(), 'ahpd-release-'));
  try {
    const made = [];
    for (const one of locksOf(part)) made.push({ folder: one.folder, ...await releaseLock(join(scratch, one.folder), one, packed) });
    for (const one of made) {
      const dir = join(dirname(FILE), 'parts', one.folder);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), one.manifest);
      await writeFile(join(dir, 'package-lock.json'), one.lock);
    }
    await writeFile(FILE, layout(parts));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return version;
};

if (releaseAt !== -1) {
  try {
    if (argv[releaseAt + 1] === undefined) throw new Error('--release takes the folder of the packed packages');
    console.log(`the ahpd part is ${await release(argv[releaseAt + 1])}`);
    process.exit(0);
  } catch (error) {
    console.log(`not released: ${error.message}`);
    process.exit(1);
  }
}

if (locksOnly) process.exit(await lockAll(parts) ? 0 : 1);

const entries = await entriesOf();
const moved = [];
const movedParts = [];
const skipped = [];

for (const part of parts) {
  let what;
  try {
    what = await bumpOf(part, entries);
  } catch (error) {
    skipped.push(`${part.id}: ${error.message}`);
    continue;
  }
  if (what.version === undefined) {
    skipped.push(`${part.id}: ${what.skipped}`);
    continue;
  }
  const was = part.version;
  moved.push(`${part.id} ${was} -> ${what.version}${what.archives === undefined ? '' : `, ${Object.keys(what.archives).length} archives`}`);
  movedParts.push(part);
  part.version = what.version;
  if (what.archives !== undefined) part.archives = what.archives;
}

for (const line of moved) console.log(`bumped ${line}`);
for (const line of skipped) console.log(`skipped ${line}`);

if (moved.length === 0) console.log('Nothing moved.');
else if (dry) console.log(`${FILE} left as it is: --dry-run.`);
else {
  await writeFile(FILE, layout(parts));
  console.log(`Wrote ${FILE}.`);
  if (!await lockAll(movedParts)) process.exit(1);
}
