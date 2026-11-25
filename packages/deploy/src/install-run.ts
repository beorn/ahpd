/**
 * Doing what the plan said: create the entries, verify every download, switch, boot - and undo all of it.
 *
 * The manifest is the only input, so `apply` writes what `--plan` printed and `uninstall` removes what `apply` wrote.
 * Every outside effect (a network fetch, a command, a file) arrives through `InstallIo`, so a test holds the order, the
 * refusals and the checksums without touching a real host. `nodeInstallIo` is the real host: node's own filesystem,
 * `fetch` and `/bin/sh`.
 *
 * Two rules from @cto's reads (#38280) live here:
 * - a download is hashed and compared to its pin **before** it is placed, and a mismatch stops the install by name;
 * - `apply` refuses a root it did not create. An existing directory with no `install.json` is somebody else's state -
 *   a developer's `~/.ahpd` included - and an explicit `$AHPD_HOME` gets no exemption.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { activateRelease, type InstallManifest, type InstallPin } from './index.js';

export interface RunResult {
  readonly code: number;
  readonly output: string;
}

/** Every effect a customer install has, named so a test can hold it and a person can read what it will run. */
export interface InstallIo {
  readonly exists: (path: string) => boolean;
  readonly mkdir: (path: string) => void;
  readonly writeFile: (path: string, bytes: string) => void;
  /** Writes the fetched bytes at `path`. Its caller hashes what it wrote. */
  readonly fetchTo: (source: string, path: string) => Promise<void>;
  /** Moves verified bytes into place: a binary never travels through a decoded string. */
  readonly move: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
  readonly run: (command: string) => RunResult;
  readonly hash: (path: string, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64') => string;
}

/** The real host. A refetch or a failed command answers with its code and words; nothing here pretends to succeed. */
export const nodeInstallIo = (): InstallIo => ({
  exists: (path) => existsSync(path),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, bytes) => writeFileSync(path, bytes),
  fetchTo: async (source, path) => {
    const answered = await fetch(source);
    if (!answered.ok) throw new Error(`${source} answered ${String(answered.status)}`);
    writeFileSync(path, Buffer.from(await answered.arrayBuffer()));
  },
  move: (from, to) => renameSync(from, to),
  remove: (path) => rmSync(path, { force: false }),
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
  | { readonly kind: 'step-failed'; readonly step: string; readonly output: string };

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
    case 'step-failed':
      return `refused: ${refusal.step} failed: ${refusal.output}`;
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

/**
 * Create exactly what the manifest lists, or refuse and leave the host as it was found.
 *
 * Refusals come before the effect they protect: a foreign root before anything is created, a download's checksum
 * before it is placed, a boot item command's own words when it fails. `current` moves only through the deploy
 * driver's `activateRelease`, so the journal keeps the switch.
 */
export const applyInstall = async (
  manifest: InstallManifest,
  io: InstallIo,
  switchTo: typeof activateRelease = activateRelease,
): Promise<ApplyResult> => {
  const wrote: string[] = [];
  const installedManifest = `${manifest.root}/install.json`;
  if (io.exists(manifest.root) && !io.exists(installedManifest))
    return { ok: false, wrote, refusal: { kind: 'foreign-root', path: manifest.root } };

  for (const entry of manifest.entries) {
    if (entry.kind === 'dir') {
      io.mkdir(entry.path);
      wrote.push(entry.path);
      continue;
    }
    // The switch writes the symlink; the boot item's own file is written below, before its enable command runs.
    if (entry.kind === 'symlink') continue;
    if (entry.from === 'generated:boot-item') {
      io.writeFile(entry.path, bootContent(manifest));
      wrote.push(entry.path);
      continue;
    }
    if (entry.kind === 'boot-item') {
      io.mkdir(dirname(entry.path));
      io.writeFile(entry.path, bootContent(manifest));
      wrote.push(entry.path);
      continue;
    }
    if (entry.from?.startsWith('download:') === true) {
      const name = entry.from.slice('download:'.length) as keyof InstallManifest['pins'];
      const pin = manifest.pins[name];
      const staging = `${entry.path}.download`;
      await io.fetchTo(pin.source, staging);
      const { algorithm, encoding } = pinDigest(pin.checksum ?? 'sha256:');
      const actual = io.hash(staging, algorithm, encoding);
      if (actual !== expectedDigest(pin)) {
        io.remove(staging);
        return { ok: false, wrote, refusal: { kind: 'checksum-mismatch', download: name, expected: expectedDigest(pin), actual } };
      }
      io.move(staging, entry.path);
    } else if (entry.path === installedManifest) {
      io.writeFile(entry.path, JSON.stringify(manifest, null, 2));
    } else {
      return { ok: false, wrote, refusal: { kind: 'step-failed', step: entry.path, output: 'the manifest names no source for this file' } };
    }
    wrote.push(entry.path);
  }

  switchTo({ stateDir: `${manifest.root}/state`, service: 'ahpd' }, manifest.version, 'customer host install');

  const enabled = io.run(manifest.bootItem.enable);
  if (enabled.code !== 0)
    return { ok: false, wrote, refusal: { kind: 'step-failed', step: 'enable boot item', output: enabled.output } };
  return { ok: true, wrote };
};

export interface UninstallResult {
  readonly ok: boolean;
  readonly removed: readonly string[];
  readonly refusal?: ApplyRefusal;
}

/** Turn the boot item off first, then remove exactly the recorded entries, last created first. */
export const uninstallInstall = (manifest: InstallManifest, io: InstallIo): UninstallResult => {
  const removed: string[] = [];
  const disabled = io.run(manifest.bootItem.disable);
  if (disabled.code !== 0)
    return { ok: false, removed, refusal: { kind: 'step-failed', step: 'disable boot item', output: disabled.output } };
  for (const entry of [...manifest.entries].reverse()) {
    io.remove(entry.path);
    removed.push(entry.path);
  }
  return { ok: true, removed };
};

/** The file a launchd agent or a systemd user unit reads: one copy loaded, one kept under the root as the record. */
const bootContent = (manifest: InstallManifest): string =>
  manifest.bootItem.kind === 'launchd-agent' ? launchdAgent(manifest) : systemdUnit(manifest);

/** Starts the daemon from `current` in the user's own session; the token is the user's, not root's. */
const launchdAgent = (manifest: InstallManifest): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>dev.hallohuman.ahpd</string>',
    '  <key>ProgramArguments</key><array>',
    `    <string>${manifest.root}/state/deploy/ahpd/current/supervisor</string>`,
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><true/>',
    '  <key>StandardOutPath</key>',`    <string>${manifest.root}/state/ahpd.out.log</string>`,
    '  <key>StandardErrorPath</key>',`    <string>${manifest.root}/state/ahpd.err.log</string>`,
    '</dict></plist>',
  ].join('\n');

const systemdUnit = (manifest: InstallManifest): string =>
  [
    '[Unit]',
    'Description=ahpd (Hallohuman agent host), user session',
    'After=default.target',
    '',
    '[Service]',
    `ExecStart=${manifest.root}/state/deploy/ahpd/current/supervisor`,
    'Restart=always',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=default.target',
  ].join('\n');
