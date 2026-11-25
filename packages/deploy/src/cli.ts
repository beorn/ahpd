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

const MODE_FLAGS = ['--plan', '--apply', '--uninstall'] as const;
const VALUE_FLAGS = new Set(['--pins', '--root', '--home']);
const KNOWN_FLAGS = new Set<string>([...MODE_FLAGS, ...VALUE_FLAGS, '--purge', '--help']);
const PIN_NAMES = ['runtime', 'ahpd', 'hostPlugin', 'supervisor'] as const;

interface PinsFile {
  readonly version: string;
  readonly platform: InstallPlatform;
  readonly pins: InstallPins;
}

interface ParsedArgs {
  readonly flags: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
}

/**
 * Every argument is a known flag with its value where one is due, or it is refused by name. A value flag followed by
 * another flag means the value went missing, not that `--root` is a directory called `--home`.
 */
const parseArgs = (argv: readonly string[]): ParsedArgs | string => {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const one = argv[index] as string;
    if (VALUE_FLAGS.has(one)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) return `${one} needs a value`;
      values.set(one, next);
      index += 1;
      continue;
    }
    if (!KNOWN_FLAGS.has(one)) return one.startsWith('--') ? `${one} is not an option` : `${one} is not an argument`;
    flags.add(one);
  }
  return { flags, values };
};

/**
 * Shape only: whether a pin is a good download is `installRefusals`, which the plan reports per pin. A pin missing its
 * version, source or checksum field would reach that code as a TypeError instead, so the file is named here first.
 */
const pinShapeProblem = (file: string, pins: unknown): string | undefined => {
  if (typeof pins !== 'object' || pins === null) return `${file} names no pins`;
  const named = pins as Record<string, unknown>;
  for (const name of PIN_NAMES) {
    const pin = named[name];
    if (typeof pin !== 'object' || pin === null) return `${file} has no ${name} pin`;
    const fields = pin as Record<string, unknown>;
    if (typeof fields['version'] !== 'string' || fields['version'] === '')
      return `${file} pin ${name} names no version`;
    if (typeof fields['source'] !== 'string' || fields['source'] === '')
      return `${file} pin ${name} names no source`;
    const checksum = fields['checksum'];
    if (checksum !== null && (typeof checksum !== 'string' || checksum === ''))
      return `${file} pin ${name} checksum must be a string or null`;
  }
  return undefined;
};

const read = (file: string): PinsFile => {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PinsFile>;
  if (typeof parsed.version !== 'string' || parsed.version === '') throw new Error(`${file} names no version`);
  if (parsed.platform !== 'darwin' && parsed.platform !== 'linux')
    throw new Error(`${file} platform must be darwin or linux`);
  const problem = pinShapeProblem(file, parsed.pins);
  if (problem !== undefined) throw new Error(problem);
  return { version: parsed.version, platform: parsed.platform, pins: parsed.pins as InstallPins };
};

/** One command, one exit code; every refusal says what it refused and why. */
export const run = async (
  argv: readonly string[],
  io: InstallIo = nodeInstallIo(),
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): Promise<number> => {
  if (argv.length === 0) {
    out(USAGE);
    return 0;
  }
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    err(`refused: ${parsed}. ${USAGE}`);
    return 2;
  }
  const { flags, values } = parsed;
  if (flags.has('--help')) {
    out(USAGE);
    return 0;
  }

  const modes = MODE_FLAGS.filter((one) => flags.has(one));
  if (modes.length > 1) {
    err(`refused: ${modes.join(' and ')} cannot be combined. ${USAGE}`);
    return 2;
  }
  if (flags.has('--purge') && !flags.has('--uninstall')) {
    err(`refused: --purge needs --uninstall. ${USAGE}`);
    return 2;
  }

  const pinsFile = values.get('--pins');
  if (pinsFile === undefined) {
    err(`refused: --pins is required. ${USAGE}`);
    return 2;
  }
  // Read the home, never guess: without one the install root would land at `/`, which no customer asked for.
  const home = values.get('--home') ?? process.env['HOME'];
  if (home === undefined || home === '') {
    err(`refused: HOME is not set; pass --home. ${USAGE}`);
    return 2;
  }

  let file: PinsFile;
  try {
    file = read(pinsFile);
  } catch (error) {
    err(`refused: ${pinsFile}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const root = values.get('--root');
  const built = customerInstallManifest({
    platform: file.platform,
    version: file.version,
    home,
    ...(root === undefined ? {} : { root }),
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
