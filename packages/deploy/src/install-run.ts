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
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { activateRelease, type InstallManifest, type InstallPin } from './index.js';

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
  readonly remove: (path: string) => void;
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
  remove: (path) => rmSync(path, { force: false }),
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
    entry.kind === 'file' && entry.from?.startsWith('download:') === true
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
    return { ok: false, wrote, refusal: { kind: 'foreign-root', path: manifest.root } };

  const root = await attempt('create install root', manifest.root, () => io.mkdir(manifest.root));
  if (!root.ok) return { ok: false, wrote, refusal: root.refusal };

  // The record goes down first, so a failure below leaves a folder the next apply recognises as its own.
  const opened = await attempt('write install record', installedManifest, () =>
    io.writeFile(installedManifest, JSON.stringify({ state: 'installing', manifest } satisfies InstallRecord, null, 2)),
  );
  if (!opened.ok) return { ok: false, wrote, refusal: opened.refusal };
  wrote.push(installedManifest);

  for (const entry of manifest.entries) {
    if (entry.path === installedManifest) continue;
    if (entry.kind === 'dir') {
      const made = await attempt('create directory', entry.path, () => io.mkdir(entry.path));
      if (!made.ok) return { ok: false, wrote, refusal: made.refusal };
      wrote.push(entry.path);
      continue;
    }
    // The switch writes the symlink; the boot item's own file is written below, before its enable command runs.
    if (entry.kind === 'symlink') continue;
    if (entry.from === 'generated:boot-item') {
      const written = await attempt('write boot item record', entry.path, () => io.writeFile(entry.path, bootContent(manifest)));
      if (!written.ok) return { ok: false, wrote, refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    if (entry.kind === 'boot-item') {
      const written = await attempt('write boot item', entry.path, () => {
        io.mkdir(dirname(entry.path));
        io.writeFile(entry.path, bootContent(manifest));
      });
      if (!written.ok) return { ok: false, wrote, refusal: written.refusal };
      wrote.push(entry.path);
      continue;
    }
    if (entry.from?.startsWith('download:') === true) {
      const name = entry.from.slice('download:'.length) as keyof InstallManifest['pins'];
      const pin = manifest.pins[name];
      // No silent default: a null checksum at apply time is refused, even though the plan refuses it first.
      if (pin.checksum === null)
        return { ok: false, wrote, refusal: { kind: 'missing-checksum', download: name } };
      const staging = `${entry.path}.download`;
      const fetched = await attempt('download', pin.source, () => io.fetchTo(pin.source, staging));
      if (!fetched.ok) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, refusal: fetched.refusal };
      }
      const { algorithm, encoding } = pinDigest(pin.checksum);
      const actual = io.hash(staging, algorithm, encoding);
      if (actual !== expectedDigest(pin)) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, refusal: { kind: 'checksum-mismatch', download: name, expected: expectedDigest(pin), actual } };
      }
      // Verified bytes, made executable, then placed: what runs is what was checked.
      const placed = await attempt('place download', entry.path, () => {
        io.chmod(staging, EXECUTABLE_MODE);
        io.move(staging, entry.path);
      });
      if (!placed.ok) {
        await attempt('remove staged download', staging, () => io.remove(staging));
        return { ok: false, wrote, refusal: placed.refusal };
      }
      wrote.push(entry.path);
      continue;
    }
    return {
      ok: false,
      wrote,
      refusal: { kind: 'step-failed', step: 'write file', path: entry.path, output: 'the manifest names no source for this file' },
    };
  }

  switchTo({ stateDir: `${manifest.root}/state`, service: 'ahpd' }, manifest.version, 'customer host install');

  const enabled = await attempt('enable boot item', manifest.bootItem.path, () => io.run(manifest.bootItem.enable));
  if (!enabled.ok) return { ok: false, wrote, refusal: enabled.refusal };
  if (enabled.value.code !== 0)
    return {
      ok: false,
      wrote,
      refusal: { kind: 'step-failed', step: 'enable boot item', path: manifest.bootItem.path, output: enabled.value.output },
    };

  const closed = await attempt('finish install record', installedManifest, () =>
    io.writeFile(installedManifest, JSON.stringify({ state: 'installed', manifest } satisfies InstallRecord, null, 2)),
  );
  if (!closed.ok) return { ok: false, wrote, refusal: closed.refusal };
  return { ok: true, wrote };
};

export interface UninstallOptions {
  /** Also delete what the install did not write - the daemon's sessions, records and logs. Never the default. */
  readonly purge?: boolean;
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
        io.removeTree(entry.path);
        removed.push(entry.path);
      } else {
        const count = `${String(entries.length)} ${entries.length === 1 ? 'entry' : 'entries'}`;
        kept.push(`kept ${entry.path}: ${count} not written by this install; remove by hand or run uninstall --purge`);
      }
      continue;
    }
    io.remove(entry.path);
    removed.push(entry.path);
  }
  return { ok: true, removed, kept };
};

/** The file a launchd agent or a systemd user unit reads: one copy loaded, one kept under the root as the record. */
const bootContent = (manifest: InstallManifest): string =>
  manifest.bootItem.kind === 'launchd-agent' ? launchdAgent(manifest) : systemdUnit(manifest);

/** A path inside XML text and attributes: `&` first, or the escapes escape each other. */
const xmlEscape = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/** Starts the daemon from `current` in the user's own session; the token is the user's, not root's. */
const launchdAgent = (manifest: InstallManifest): string => {
  const root = xmlEscape(manifest.root);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>dev.hallohuman.ahpd</string>',
    '  <key>ProgramArguments</key><array>',
    `    <string>${root}/state/deploy/ahpd/current/supervisor</string>`,
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

/** `WantedBy` alone: pairing it with `After=default.target` is the ordering cycle systemd warns about. */
const systemdUnit = (manifest: InstallManifest): string =>
  [
    '[Unit]',
    'Description=ahpd (Hallohuman agent host), user session',
    '',
    '[Service]',
    `ExecStart=${manifest.root}/state/deploy/ahpd/current/supervisor`,
    'Restart=always',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');

export { xmlEscape };
