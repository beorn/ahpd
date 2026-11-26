/**
 * Doing what the plan said: create the entries, verify every download, switch, boot - and undo all of it.
 *
 * The manifest is the only input, so `apply` writes what `--plan` printed and `uninstall` removes what `apply` wrote.
 * Every outside effect (a network fetch, a command, a file) arrives through `InstallIo`, so a test holds the order, the
 * refusals and the checksums without touching a real host. `nodeInstallIo` is the real host: node's own filesystem,
 * `fetch` and `/bin/sh`.
 *
 * Rules from @cto's reads (#38280) live here:
 * - a download is hashed and compared to its pin **before** it is placed, and the executables are made executable then;
 * - `apply` refuses a root it did not create. An existing directory with no `install.json` is somebody else's state -
 *   a developer's `~/.ahpd` included - and an explicit `$AHPD_HOME` gets no exemption;
 * - the record is written first, as `installing`, and last, as `installed`, so an interrupted install resumes instead
 *   of refusing its own folder;
 * - `uninstall` removes what the install wrote and keeps anything else, naming it; only `--purge` deletes that;
 * - every effect that throws becomes a refusal naming the step and the path, never a crash.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { activateRelease, DEFAULT_KEEP, releasesToPrune, type DeployLayout, type InstallManifest, type InstallPin } from './index.js';
import { unpackArchive } from './untar.js';

export interface RunResult {
  readonly code: number;
  readonly output: string;
}

/** Every effect a customer install has, named so a test can hold it and a person can read what it will run. */
export interface InstallIo {
  readonly exists: (path: string) => boolean;
  readonly isDirectory: (path: string) => boolean;
  readonly list: (path: string) => readonly string[];
  readonly readFile: (path: string) => string;
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, bytes: string) => void;
  /** The mode an executable needs; a download arrives 0644 and cannot run. */
  readonly chmod: (path: string, mode: number) => void;
  /** Writes the fetched bytes at `path`. Its caller hashes what it wrote. */
  readonly fetchTo: (source: string, path: string) => Promise<void>;
  /** Moves verified bytes into place: a binary never travels through a decoded string. */
  readonly move: (from: string, to: string) => void;
  /**
   * Unpacks a verified release archive into `into`, keeping the modes and refusing any unsafe entry as a whole; the
   * top directory must be named `topDir` (@cto 2026-11-25). It throws with the entry it refused.
   */
  readonly unpack: (archive: string, into: string, topDir: string) => void;
  /** Removes a file, or an empty directory; a path that is already gone is not an error. */
  readonly remove: (path: string) => void;
  /** Every path under a directory, for the list `--purge` prints before it deletes. */
  readonly listTree: (path: string) => readonly string[];
  /** Removes a directory and everything under it: only `uninstall --purge` reaches for this. */
  readonly removeTree: (path: string) => void;
  readonly run: (command: string) => RunResult;
  readonly hash: (path: string, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64') => string;
}

/** The real host. A failed command or fetch answers with its own words; nothing here pretends to succeed. */
export const nodeInstallIo = (): InstallIo => ({
  exists: (path) => existsSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
  list: (path) => readdirSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  chmod: (path, mode) => chmodSync(path, mode),
  fetchTo: async (source, path) => {
    const answered = await fetch(source);
    if (!answered.ok) throw new Error(`${source} answered ${String(answered.status)}`);
    writeFileSync(path, Buffer.from(await answered.arrayBuffer()));
  },
  move: (from, to) => renameSync(from, to),
  unpack: (archive, into, topDir) => {
    unpackArchive(archive, into, topDir);
  },
  // A directory needs its own call: rmSync without `recursive` refuses one, and saying "removed" after a refusal is
  // the silent error this row exists to prevent. `lstat`, never `stat`: `current` is a symlink to a release folder, and
  // following it makes a directory out of a link that has to be unlinked — rmdir on a link is ENOTDIR.
  remove: (path) => {
    if (lstatSync(path).isDirectory()) rmdirSync(path);
    else unlinkSync(path);
  },
  listTree: (path) => readdirSync(path, { recursive: true, encoding: 'utf8' }),
  removeTree: (path) => rmSync(path, { recursive: true, force: false }),
  run: (command) => {
    const done = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    return { code: done.status ?? 1, output: `${done.stdout ?? ''}${done.stderr ?? ''}`.trim() };
  },
  hash: (path, algorithm, encoding) => createHash(algorithm).update(readFileSync(path)).digest(encoding),
});

export type ApplyRefusal =
  | { readonly kind: 'foreign-root'; readonly path: string }
  | {
      readonly kind: 'checksum-mismatch';
      readonly download: keyof InstallManifest['pins'];
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly kind: 'step-failed'; readonly step: string; readonly path: string; readonly output: string }
  | { readonly kind: 'missing-checksum'; readonly download: keyof InstallManifest['pins'] };

export interface ApplyResult {
  readonly ok: boolean;
  readonly wrote: readonly string[];
  /** Release folders the prune removed, oldest first: a switch says what it deleted, not just what it installed. */
  readonly pruned: readonly string[];
  /** Directories in `releases/` that were not pruned and why, so a stray folder is named rather than guessed at. */
  readonly keptReleases: readonly { readonly name: string; readonly why: string }[];
  /**
   * A tidy-up that failed after a release was running and recorded. The install is still good, so this never sets
   * `ok` false or `refusal`: printing it and exiting 0 is what keeps the disk filling visible without calling a live
   * host a failed install (@cto 2026-11-25).
   */
  readonly pruneFailed?: { readonly path: string; readonly output: string };
  readonly refusal?: ApplyRefusal;
}

export const describeApplyRefusal = (refusal: ApplyRefusal): string => {
  switch (refusal.kind) {
    case 'foreign-root':
      return `refused: ${refusal.path} already exists and this install did not create it (no install.json); nothing was changed`;
    case 'checksum-mismatch':
      return `refused: ${refusal.download} does not match its pinned checksum (expected ${refusal.expected}, got ${refusal.actual}); nothing was placed`;
    case 'missing-checksum':
      return `refused: ${refusal.download} has no checksum at apply time; nothing was placed`;
    case 'step-failed':
      return `refused: ${refusal.step} at ${refusal.path}: ${refusal.output}`;
  }
};

/** The digest a pin states, split into the algorithm and the encoding its own shape decides. */
export const pinDigest = (checksum: string): { algorithm: 'sha256' | 'sha512'; encoding: 'hex' | 'base64' } =>
  checksum.startsWith('sha256:') ? { algorithm: 'sha256', encoding: 'hex' } : { algorithm: 'sha512', encoding: 'base64' };

/** What a pin's checksum must equal, in the encoding `pinDigest` reads a file in. */
export const expectedDigest = (pin: InstallPin): string =>
  pin.checksum === null
    ? ''
    : pinDigest(pin.checksum).algorithm === 'sha256'
      ? pin.checksum.slice('sha256:'.length)
      : pin.checksum.slice('sha512-'.length);

interface DownloadEntry {
  readonly path: string;
  readonly name: keyof InstallManifest['pins'];
}

/** Every entry the manifest fills from a pin, in creation order. */
export const downloadEntries = (manifest: InstallManifest): readonly DownloadEntry[] =>
  manifest.entries.flatMap((entry) =>
    (entry.kind === 'file' || entry.kind === 'archive') && entry.from?.startsWith('download:') === true
      ? [{ path: entry.path, name: entry.from.slice('download:'.length) as keyof InstallManifest['pins'] }]
      : [],
  );

/** What was downloaded is what runs: the four pinned artifacts are executables. */
const EXECUTABLE_MODE = 0o755;

/** The record `install.json` carries: the manifest and the state the next apply reads. */
export interface InstallRecord {
  readonly state: 'installing' | 'installed';
  readonly manifest: InstallManifest;
}

/** A folder name that is a version, not a stray directory somebody left in `releases/`. */
export const isVersion = (name: string): boolean => /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/u.test(name);

/**
 * Newest first, by semver's own order: numeric core parts, then pre-release parts segment by segment, numeric when
 * both are numeric, so `1.0.0-rc.10` is above `1.0.0-rc.9` and a release is above its own release candidate.
 */
export const compareVersions = (left: string, right: string): number => {
  const parse = (one: string): { core: readonly number[]; pre: readonly string[] } => {
    const [core = '', pre = ''] = one.replace(/^v/u, '').split(/[-+]/u, 2) as [string, string?];
    return {
      core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: pre === '' ? [] : pre.split('.'),
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const difference = (b.core[index] ?? 0) - (a.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return -left.localeCompare(right);
  if (a.pre.length === 0) return -1;
  if (b.pre.length === 0) return 1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    const numericX = Number(x);
    const numericY = Number(y);
    if (!Number.isNaN(numericX) && !Number.isNaN(numericY)) {
      if (numericY !== numericX) return numericY - numericX;
    } else if (x !== y) return y.localeCompare(x);
  }
  return 0;
};

const isMissingPath = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';

export interface PruneKept {
  readonly name: string;
  readonly why: string;
}

export type PruneOutcome =
  | { readonly ok: true; readonly removed: readonly string[]; readonly kept: readonly PruneKept[] }
  | {
      readonly ok: false;
      readonly path: string;
      readonly output: string;
      /** What was already gone when it stopped, so a partial prune is reported as one, never as nothing. */
      readonly removed: readonly string[];
      readonly kept: readonly PruneKept[];
    };

/**
 * Keep `current`, the release it switched from, and the newest releases up to `keep`, by the same rule
 * `pruneReleases` uses; only the ordering is different here because a customer install names folders by version
 * rather than by commit.
 *
 * No release folders at all is a fact, not an error. Any other failure to list them is a refusal: silently pruning
 * nothing would report a clean switch while the disk fills. A folder whose name is not a version is never pruned and
 * is named, because it is not ours to guess about.
 *
 * Each removal is its own attempt: one folder that cannot be deleted (EBUSY, EACCES) stops the prune with that folder
 * named and the ones already gone listed. It never escapes the caller as an exception after the install was recorded.
 */
export const pruneReleaseFolders = (
  io: Pick<InstallIo, 'list' | 'removeTree'>,
  layout: DeployLayout,
  current: string | null,
  keep = DEFAULT_KEEP,
  rollback: string | null = null,
): PruneOutcome => {
  const releases = `${layout.stateDir}/deploy/${layout.service}/releases`;
  let names: readonly string[];
  try {
    names = io.list(releases);
  } catch (error) {
    if (isMissingPath(error)) return { ok: true, removed: [], kept: [] };
    return { ok: false, path: releases, output: message(error), removed: [], kept: [] };
  }
  const versions = names.filter(isVersion);
  const kept: PruneKept[] = names
    .filter((name) => !isVersion(name))
    .map((name) => ({ name, why: 'not a version' }));
  const removed = releasesToPrune([...versions].sort(compareVersions), current, keep, rollback);
  const done: string[] = [];
  for (const name of removed) {
    const folder = `${releases}/${name}`;
    try {
      io.removeTree(folder);
    } catch (error) {
      return { ok: false, path: folder, output: message(error), removed: done, kept };
    }
    done.push(name);
  }
  return { ok: true, removed: done, kept };
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One effect, held to a refusal that names the step and the path when it throws. */
const attempt = async <T>(
  step: string,
  path: string,
  run: () => T | Promise<T>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: ApplyRefusal }> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, refusal: { kind: 'step-failed', step, path, output: message(error) } };
  }
};

/**
 * Create exactly what the manifest lists, or refuse and leave the host as it was found.
 *
 * Refusals come before the effect they protect: a foreign root before anything is created, a download's checksum
 * before it is placed, a failing command with its own words. `current` moves only through the deploy driver's
 * `activateRelease`, so the journal keeps the switch.
 */
export const applyInstall = async (
  manifest: InstallManifest,
  io: InstallIo,
  switchTo: typeof activateRelease = activateRelease,
): Promise<ApplyResult> => {
  const wrote: string[] = [];
  const installedManifest = `${manifest.root}/install.json`;

  // A foreign root is never adopted. Our own record - even from an interrupted run - is ours to finish.
  if (io.exists(manifest.root) && !io.exists(installedManifest))
    return { ok: false, wrote, pruned: [], keptReleases: [], refusal: { kind: 'foreign-root', path: manifest.root } };
  // A record that will not parse is refused, never read as a fresh install: that would overwrite the only statement of
  // what this folder owns (@cto 2026-11-25). A finished record we are re-applying is a switch, so the boot item is
  // restarted rather than bootstrapped twice.
  let previous: InstallManifest | null = null;
  let upgrading = false;
  if (io.exists(installedManifest)) {
    let record: InstallRecord;
    try {
      record = JSON.parse(io.readFile(installedManifest)) as InstallRecord;
    } catch (error) {
      return {
        ok: false,
        wrote,
        pruned: [],
        keptReleases: [],
        refusal: {
          kind: 'step-failed',
          step: 'read install record',
          path: installedManifest,
          output: `install record at ${installedManifest} is unreadable: ${message(error)}; nothing changed`,
        },
      };
    }
    previous = record.manifest ?? null;
    upgrading = record.state === 'installed';
  }

  const root = await attempt('create install root', manifest.root, () => io.mkdir(manifest.root));
  if (!root.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: root.refusal };

  // The record goes down first, so a failure below leaves a folder the next apply recognises as its own.
  const opened = await attempt('write install record', installedManifest, () =>
    io.writeFile(installedManifest, JSON.stringify({ state: 'installing', manifest } satisfies InstallRecord, null, 2)),
  );
  if (!opened.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: opened.refusal };
  wrote.push(installedManifest);

  for (const entry of manifest.entries) {
    if (entry.path === installedManifest) continue;
    if (entry.kind === 'dir') {
      const made = await attempt('create directory', entry.path, () => io.mkdir(entry.path));
      if (!made.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: made.refusal };
      wrote.push(entry.path);
      continue;
    }
    // The switch writes the symlink and the journal line; the boot item's own file is written below, before its
    // enable command runs.
    if (entry.kind === 'symlink' || entry.from === 'generated:journal') continue;
    if (entry.from === 'generated:compose') {
      const written = await attempt('write project file', entry.path, () => io.writeFile(entry.path, composeContent(manifest)));
      if (!written.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    // Written only when absent: an upgrade keeps the machine's services byte for byte (#38277 S2).
    if (entry.from === 'generated:services') {
      if (io.exists(entry.path)) continue;
      const written = await attempt('write services file', entry.path, () => io.writeFile(entry.path, SERVICES_FILE_SEED));
      if (!written.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    if (entry.from === 'generated:boot-item') {
      const written = await attempt('write boot item record', entry.path, () => io.writeFile(entry.path, bootContent(manifest)));
      if (!written.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    if (entry.kind === 'boot-item') {
      const written = await attempt('write boot item', entry.path, () => {
        io.mkdir(dirname(entry.path));
        io.writeFile(entry.path, bootContent(manifest));
      });
      if (!written.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    if (entry.from?.startsWith('download:') === true) {
      const name = entry.from.slice('download:'.length) as keyof InstallManifest['pins'];
      const pin = manifest.pins[name];
      // No silent default: a null checksum at apply time is refused, even though the plan refuses it first.
      if (pin.checksum === null)
        return { ok: false, wrote, pruned: [], keptReleases: [], refusal: { kind: 'missing-checksum', download: name } };
      const staging = `${entry.path}.download`;
      const fetched = await attempt('download', pin.source, () => io.fetchTo(pin.source, staging));
      if (!fetched.ok) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, pruned: [], keptReleases: [], refusal: fetched.refusal };
      }
      const { algorithm, encoding } = pinDigest(pin.checksum);
      const actual = io.hash(staging, algorithm, encoding);
      if (actual !== expectedDigest(pin)) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, pruned: [], keptReleases: [], refusal: { kind: 'checksum-mismatch', download: name, expected: expectedDigest(pin), actual } };
      }
      // The daemon arrives as one archive of a whole tree: unpack it in staging, then one rename onto the release
      // folder. `current` never points at a tree that was not checked first (@cto 2026-11-25).
      if (entry.kind === 'archive') {
        const topDir = basename(pin.source).replace(/\.tar\.gz$/u, '');
        if (topDir === '' || topDir === basename(pin.source)) {
          await attempt('remove staged download', staging, () => io.remove(staging));
          return {
            ok: false,
            wrote,
            pruned: [],
            keptReleases: [],
            refusal: { kind: 'step-failed', step: 'unpack archive', path: entry.path, output: `the pinned source ${pin.source} does not name a .tar.gz archive` },
          };
        }
        const tree = `${entry.path}.staging`;
        // A tree left by an interrupted run is cleared here, not merged: the unpack refuses an existing target, and a
        // stuck install has to recover on the next run without an operator (@dev/6 2026-11-25).
        if (io.exists(tree)) {
          const cleared = await attempt('remove leftover staging tree', tree, () => io.removeTree(tree));
          if (!cleared.ok) {
            await attempt('remove staged download', staging, () => io.remove(staging));
            return { ok: false, wrote, pruned: [], keptReleases: [], refusal: cleared.refusal };
          }
        }
        const unpacked = await attempt('unpack archive', entry.path, () => io.unpack(staging, tree, topDir));
        if (!unpacked.ok) {
          await attempt('remove staged download', staging, () => io.remove(staging));
          await attempt('remove unpacked tree', tree, () => io.removeTree(tree));
          return { ok: false, wrote, pruned: [], keptReleases: [], refusal: unpacked.refusal };
        }
        const placedTree = await attempt('place release tree', entry.path, () => io.move(tree, entry.path));
        if (!placedTree.ok) {
          await attempt('remove staged download', staging, () => io.remove(staging));
          await attempt('remove unpacked tree', tree, () => io.removeTree(tree));
          return { ok: false, wrote, pruned: [], keptReleases: [], refusal: placedTree.refusal };
        }
        await attempt('remove downloaded archive', staging, () => io.remove(staging));
        wrote.push(entry.path);
        continue;
      }
      // Verified bytes, made executable, then placed: what runs is what was checked.
      const placed = await attempt('place download', entry.path, () => {
        io.chmod(staging, EXECUTABLE_MODE);
        io.move(staging, entry.path);
      });
      if (!placed.ok) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, pruned: [], keptReleases: [], refusal: placed.refusal };
      }
      wrote.push(entry.path);
      continue;
    }
    return {
      ok: false,
      wrote,
      pruned: [],
      keptReleases: [],
      refusal: { kind: 'step-failed', step: 'write file', path: entry.path, output: 'the manifest names no source for this file' },
    };
  }

  const layout = { stateDir: `${manifest.root}/state`, service: 'ahpd' };
  const switched = await attempt('switch release', `${layout.stateDir}/deploy/ahpd/current`, () =>
    switchTo(
      layout,
      manifest.version,
      upgrading ? `customer host switch to ${manifest.version}` : 'customer host install',
    ),
  );
  if (!switched.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: switched.refusal };

  // The loaded boot item points at `current`, so a switch needs it restarted; a first install just starts it.
  const stopped = upgrading
    ? await attempt('stop the running release', manifest.bootItem.path, () => io.run(manifest.bootItem.disable))
    : { ok: true as const, value: { code: 0, output: '' } };
  const stoppedOutput = stopped.ok
    ? stopped.value.output
    : stopped.refusal.kind === 'step-failed'
      ? stopped.refusal.output
      : '';
  const stoppedClause = upgrading ? (stoppedOutput === '' ? 'stopping it said nothing' : stoppedOutput) : '';
  const enabled = await attempt('enable boot item', manifest.bootItem.path, () => io.run(manifest.bootItem.enable));
  const started = enabled.ok && enabled.value.code === 0;
  if (!started) {
    const failure = enabled.ok ? enabled.value.output : enabled.refusal.kind === 'step-failed' ? enabled.refusal.output : '';
    // A failed start goes back to the release that was running, so a bad switch never leaves a dead host pointing at
    // a release nobody has started (@cto 2026-11-25).
    if (upgrading && previous !== null) {
      // Wrapped like every other step: a switch or a runner that throws is a named failure, never an escape out of
      // applyInstall.
      const switchedBack = await attempt(
        'switch back to the previous release',
        `${layout.stateDir}/deploy/${layout.service}/current`,
        () => switchTo(layout, previous.version, 'switching back after a failed start', { back: true }),
      );
      const restarted = await attempt('start the previous release', manifest.bootItem.path, () =>
        io.run(manifest.bootItem.enable),
      );
      const restored = await attempt('restore install record', installedManifest, () =>
        io.writeFile(
          installedManifest,
          JSON.stringify({ state: 'installed', manifest: previous } satisfies InstallRecord, null, 2),
        ),
      );
      const restartedOutput = restarted.ok
        ? restarted.value.output
        : restarted.refusal.kind === 'step-failed'
          ? restarted.refusal.output
          : '';
      // Anything short of "the old release is running again and recorded" is said in its own clause, so "the host is
      // down" can never be read as "the host is back on the old version" (@cto 2026-11-25).
      const backFailed: string[] = [];
      if (!switchedBack.ok)
        backFailed.push(
          `switch-back to ${previous.version} also failed: ${
            switchedBack.refusal.kind === 'step-failed' ? switchedBack.refusal.output : ''
          }`.trim(),
        );
      if (!restarted.ok || restarted.value.code !== 0)
        backFailed.push(`switch-back to ${previous.version} also failed: ${restartedOutput}`.trim());
      if (!restored.ok)
        backFailed.push(
          `switch-back to ${previous.version} also failed: could not restore the install record: ${
            restored.refusal.kind === 'step-failed' ? restored.refusal.output : ''
          }`.trim(),
        );
      // The old release's own output is carried once, in the clause above; here only whether `current` moved.
      const backClause = !switchedBack.ok
        ? `could not switch back to ${previous.version}`
        : restarted.ok && restarted.value.code === 0
          ? `switched back to ${previous.version}: ${restartedOutput}`
          : `switched back to ${previous.version}, but it did not start`;
      return {
        ok: false,
        wrote,
        pruned: [],
        keptReleases: [],
        refusal: {
          kind: 'step-failed',
          step: 'enable boot item',
          path: manifest.bootItem.path,
          // Both halves of the attempt, then the switch back and its own start: nothing is left to guess.
          output: [stoppedClause, `then ${failure}`, backClause, ...backFailed]
            .map((line) => line.trim())
            .filter((line) => line !== '')
            .join('; '),
        },
      };
    }
    return {
      ok: false,
      wrote,
      pruned: [],
      keptReleases: [],
      refusal: {
        kind: 'step-failed',
        step: 'enable boot item',
        path: manifest.bootItem.path,
        output: failure,
      },
    };
  }

  // The release is running and is about to be recorded, so it is installed: the record goes down before the tidy-up.
  // A prune that fails after this point is reported and still means a good install - never "installing" over a live
  // release (@cto 2026-11-25).
  const closed = await attempt('finish install record', installedManifest, () =>
    io.writeFile(installedManifest, JSON.stringify({ state: 'installed', manifest } satisfies InstallRecord, null, 2)),
  );
  if (!closed.ok) return { ok: false, wrote, pruned: [], keptReleases: [], refusal: closed.refusal };

  // Only a started release is worth keeping the disk tidy for: a failed switch pruned nothing above.
  const prunedNow = pruneReleaseFolders(io, layout, manifest.version, DEFAULT_KEEP, previous?.version ?? null);
  if (!prunedNow.ok)
    return {
      ok: true,
      wrote,
      pruned: prunedNow.removed,
      keptReleases: prunedNow.kept,
      pruneFailed: { path: prunedNow.path, output: prunedNow.output },
    };
  return { ok: true, wrote, pruned: prunedNow.removed, keptReleases: prunedNow.kept };
};

export interface UninstallOptions {
  /** Also delete what the install did not write - the daemon's sessions, records and logs. Never the default. */
  readonly purge?: boolean;
  /** Called with everything under a kept directory before `--purge` deletes it; returning false keeps it. */
  readonly confirmPurge?: (paths: readonly string[]) => boolean;
}

export interface UninstallResult {
  readonly ok: boolean;
  readonly removed: readonly string[];
  /** Directories kept because they hold something this install did not write, each with the sentence a person reads. */
  readonly kept: readonly string[];
  readonly refusal?: ApplyRefusal;
}

/**
 * Turn the boot item off first, then remove exactly what the install wrote, last created first.
 *
 * A directory the daemon has filled is not ours to delete: it is kept and named, with the count of what is in it.
 * `purge` deletes it too, and the caller prints the list first - customer data never goes without that flag.
 */
export const uninstallInstall = (
  manifest: InstallManifest,
  io: InstallIo,
  options: UninstallOptions = {},
): UninstallResult => {
  const removed: string[] = [];
  const kept: string[] = [];
  const disabled = io.run(manifest.bootItem.disable);
  if (disabled.code !== 0)
    return {
      ok: false,
      removed,
      kept,
      refusal: { kind: 'step-failed', step: 'disable boot item', path: manifest.bootItem.path, output: disabled.output },
    };

  for (const entry of [...manifest.entries].reverse()) {
    // A file that is already gone is a fact to say, not a failure: uninstall can be run twice.
    if (!io.exists(entry.path)) {
      removed.push(`${entry.path} (already gone)`);
      continue;
    }
    // The machine's services are the person's, not ours: kept unless --purge, and said so (#38277 S2). A file still
    // holding only the seed this install wrote is ours, and goes like any other file.
    if (entry.from === 'generated:services' && options.purge !== true && io.readFile(entry.path) !== SERVICES_FILE_SEED) {
      kept.push(`kept ${entry.path}: this machine's services; remove by hand or run uninstall --purge`);
      continue;
    }
    // A release is our tree, extracted from a pinned archive: it goes whole, and nothing in it was written by the
    // daemon (sessions and records live in `state/`, which this install never removes by default).
    if (entry.kind === 'archive') {
      try {
        io.removeTree(entry.path);
      } catch (error) {
        return {
          ok: false,
          removed,
          kept,
          refusal: { kind: 'step-failed', step: 'remove release tree', path: entry.path, output: message(error) },
        };
      }
      removed.push(entry.path);
      continue;
    }
    if (entry.kind === 'dir') {
      let entries: readonly string[];
      try {
        entries = io.list(entry.path);
      } catch (error) {
        return {
          ok: false,
          removed,
          kept,
          refusal: { kind: 'step-failed', step: 'list directory', path: entry.path, output: message(error) },
        };
      }
      if (entries.length === 0) {
        io.remove(entry.path);
        removed.push(entry.path);
      } else if (options.purge === true) {
        // The list goes to the caller before anything is deleted, so `--purge` can print exactly what it deletes.
        const inside = io.listTree(entry.path);
        if (options.confirmPurge !== undefined && !options.confirmPurge(inside)) {
          kept.push(`kept ${entry.path}: purge not confirmed`);
          continue;
        }
        io.removeTree(entry.path);
        removed.push(entry.path, ...inside);
      } else {
        const count = `${String(entries.length)} ${entries.length === 1 ? 'entry' : 'entries'}`;
        kept.push(`kept ${entry.path}: ${count} not written by this install; remove by hand or run uninstall --purge`);
      }
      continue;
    }
    try {
      io.remove(entry.path);
      removed.push(entry.path);
    } catch (error) {
      return {
        ok: false,
        removed,
        kept,
        refusal: { kind: 'step-failed', step: 'remove file', path: entry.path, output: message(error) },
      };
    }
  }
  return { ok: true, removed, kept };
};

/** The file a launchd agent or a systemd user unit reads: one copy loaded, one kept under the root as the record. */
const bootContent = (manifest: InstallManifest): string =>
  manifest.bootItem.kind === 'launchd-agent' ? launchdAgent(manifest) : systemdUnit(manifest);

/** A path inside XML text and attributes: `&` first, or the escapes escape each other. */
const xmlEscape = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/**
 * The words the boot item runs: the pinned supervisor against the release `current` points at, with the flag set the
 * #38120 trial ran under (@dev/6 df76c0d1). No working directory is needed because every path is absolute; the socket
 * and the supervisor's own log live in `state/`, outside the release a switch replaces.
 */
const supervisorArgv = (manifest: InstallManifest): readonly string[] => {
  // The service name `install.ts` files the release under (INSTALL_SERVICE is 'ahpd').
  const current = `${manifest.root}/state/deploy/ahpd/current`;
  return [
    `${current}/supervisor`,
    'up',
    '-f', `${current}/process-compose.yaml`,
    // process-compose merges its -f files in order: the release's ahpd entry, then this machine's own services.
    '-f', servicesFile(manifest),
    '-t=false',
    '-U',
    '-u', `${manifest.root}/state/pc.sock`,
    '-L', `${manifest.root}/state/process-compose.log`,
  ];
};

/** The machine's own project file: created once by the install, edited by the services plugin, kept across releases. */
const servicesFile = (manifest: InstallManifest): string => `${manifest.root}/state/services.yaml`;

/** What a new machine's services file holds: no services, and where the ahpd entry lives instead. */
const SERVICES_FILE_SEED = [
  '# This machine\'s own services. process-compose reads it after the release\'s process-compose.yaml.',
  '# Installs and upgrades never rewrite it; uninstall keeps it unless --purge.',
  'processes: {}',
  '',
].join('\n');

/** A word for the shell process-compose runs a command with: single-quoted, so a path with spaces or ` #` stays one word. */
const shellWord = (word: string): string => `'${word.replace(/'/gu, `'\\''`)}'`;

/** A YAML double-quoted scalar: JSON's string escapes are valid YAML. */
const yamlString = (text: string): string => JSON.stringify(text);

/**
 * The release's own project file (#38277 S2): one process, ahpd, started with this release's runtime against this
 * release's server, every path absolute. It names the release folder, not `current`, so the file and the tree it starts
 * always match, a switch back included. PATH is declared because a boot item's environment has none worth trusting
 * (the #38120 trial: bun was not on the unit's PATH).
 */
const composeContent = (manifest: InstallManifest): string => {
  const release = `${manifest.root}/state/deploy/ahpd/releases/${manifest.version}`;
  const command = [`${release}/runtime`, `${release}/packages/server/dist/main.js`].map(shellWord).join(' ');
  return [
    `# Written by the ahpd installer for release ${manifest.version}. Rewritten by each install of a release; edit`,
    `# ${servicesFile(manifest)} for this machine's own services.`,
    'processes:',
    '  ahpd:',
    `    command: ${yamlString(command)}`,
    '    environment:',
    `      - ${yamlString('PATH=/usr/local/bin:/usr/bin:/bin')}`,
    '    availability:',
    '      restart: always',
    '',
  ].join('\n');
};

/** Starts the daemon from `current` in the user's own session; the token is the user's, not root's. */
const launchdAgent = (manifest: InstallManifest): string => {
  const root = xmlEscape(manifest.root);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>dev.hallohuman.ahpd</string>',
    '  <key>ProgramArguments</key><array>',
    ...supervisorArgv(manifest).map((word) => `    <string>${xmlEscape(word)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><true/>',
    '  <key>StandardOutPath</key>',
    `    <string>${root}/state/ahpd.out.log</string>`,
    '  <key>StandardErrorPath</key>',
    `    <string>${root}/state/ahpd.err.log</string>`,
    '</dict></plist>',
  ].join('\n');
};

/** systemd joins ExecStart's words with spaces unquoted, so a word with whitespace is double-quoted, `\` and `"` first. */
const systemdWord = (word: string): string =>
  /[\s"\\]/u.test(word) ? `"${word.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"` : word;

/** `WantedBy` alone: pairing it with `After=default.target` is the ordering cycle systemd warns about. */
const systemdUnit = (manifest: InstallManifest): string =>
  [
    '[Unit]',
    'Description=ahpd (Hallohuman agent host), user session',
    '',
    '[Service]',
    `ExecStart=${supervisorArgv(manifest).map(systemdWord).join(' ')}`,
    'Restart=always',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');

export { SERVICES_FILE_SEED, xmlEscape };
