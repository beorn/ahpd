#!/usr/bin/env node
/**
 * `ahpd-host-install`: what the customer-facing bootstrap runs once a runtime exists (#38280).
 *
 * The one-command install is a shell script in the Hightea repo: it pins the runtime's version and sha256, checks the
 * download, and then runs this command. Everything after that is this package, so there is one manifest, one plan and
 * one switch - never a second implementation in shell.
 *
 * The pins travel in a JSON file the bootstrap ships, because the bootstrap itself must pin what it downloads before
 * any of this exists:
 *
 *   { "version": "0.15.0-rc.4", "platform": "darwin", "pins": { "runtime": { "version": "1.3.13",
 *     "source": "https://...", "checksum": "sha256:..." }, "ahpd": {...}, "hostPlugin": {...}, "supervisor": {...} } }
 */

import { readFileSync } from 'node:fs';
import {
  customerInstallManifest,
  describeRefusal,
  renderInstallPlan,
  type InstallPins,
  type InstallPlatform,
} from './install.js';
import { applyInstall, describeApplyRefusal, nodeInstallIo, uninstallInstall, type InstallIo } from './install-run.js';

export const USAGE =
  'usage: ahpd-host-install --pins <file> [--plan | --apply | --uninstall [--purge]] [--root <dir>] [--home <dir>]';

interface PinsFile {
  readonly version: string;
  readonly platform: InstallPlatform;
  readonly pins: InstallPins;
}

const read = (file: string): PinsFile => {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PinsFile>;
  if (typeof parsed.version !== 'string' || parsed.version === '')
    throw new Error(`${file} names no version`);
  if (parsed.platform !== 'darwin' && parsed.platform !== 'linux')
    throw new Error(`${file} platform must be darwin or linux`);
  if (parsed.pins === undefined) throw new Error(`${file} names no pins`);
  return { version: parsed.version, platform: parsed.platform, pins: parsed.pins };
};

/** One command, one exit code; every refusal says what it refused and why. */
export const run = async (
  argv: readonly string[],
  io: InstallIo = nodeInstallIo(),
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): Promise<number> => {
  const flags = new Set(argv.filter((one) => one.startsWith('--')));
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (flags.has('--help') || argv.length === 0) {
    out(USAGE);
    return 0;
  }
  const pinsFile = value('--pins');
  if (pinsFile === undefined) {
    err(`refused: --pins is required. ${USAGE}`);
    return 2;
  }
  const known = new Set(['--pins', '--plan', '--apply', '--uninstall', '--purge', '--root', '--home', '--help']);
  const unknown = [...flags].filter((one) => !known.has(one));
  if (unknown.length > 0) {
    err(`refused: ${unknown.join(', ')} is not an option. ${USAGE}`);
    return 2;
  }

  let file: PinsFile;
  try {
    file = read(pinsFile);
  } catch (error) {
    err(`refused: ${pinsFile}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const built = customerInstallManifest({
    platform: file.platform,
    version: file.version,
    home: value('--home') ?? process.env['HOME'] ?? '',
    ...(value('--root') === undefined ? {} : { root: value('--root') as string }),
    pins: file.pins,
  });
  if (!built.ok) {
    for (const refusal of built.refusals) err(describeRefusal(refusal));
    return 1;
  }
  const manifest = built.manifest;

  if (!flags.has('--apply') && !flags.has('--uninstall')) {
    for (const line of renderInstallPlan(manifest)) out(line);
    return 0;
  }
  if (flags.has('--uninstall')) {
    const done = uninstallInstall(manifest, io, { purge: flags.has('--purge') });
    for (const line of done.removed) out(`removed ${line}`);
    for (const line of done.kept) out(line);
    if (!done.ok && done.refusal !== undefined) {
      err(describeApplyRefusal(done.refusal));
      return 1;
    }
    return 0;
  }
  const done = await applyInstall(manifest, io);
  for (const line of done.wrote) out(`wrote ${line}`);
  for (const line of done.pruned) out(`pruned ${line}`);
  if (!done.ok && done.refusal !== undefined) {
    err(describeApplyRefusal(done.refusal));
    return 1;
  }
  return 0;
};

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
