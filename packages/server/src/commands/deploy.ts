/**
 * `ahpd deploy`: place service S on this machine at version X.
 *
 * The work is `@ahpd/deploy`'s one handler, and this file is only what a
 * terminal adds to it: the words, the declaration read from them, and the line
 * printed. Nothing here decides whether a deploy switches, switches back or
 * stops - the handler answers that from the service's declaration, so the AHP
 * methods (x-ahpd/deploy/run and /report) answer with the same values.
 *
 * A build, hook or check command is split here and run without a shell, so a
 * flag is a program and its arguments rather than a line anything re-reads.
 * Nothing about who may send a command is decided here either: the handler is
 * given the machine's gate when one exists (#38277) and this verb passes none,
 * because a person at this terminal is the machine's owner.
 */

import { readFileSync, rmSync } from 'node:fs';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { DEFAULT_KEEP, deploy } from '@ahpd/deploy';
import type { DeployCommand, DeployDeclaration, DeployResult } from '@ahpd/deploy';
import { configDir, vaultPath } from '../config.js';
import { fileVault } from '../vault.js';
import { conflict, stop } from './options.js';

/**
 * A command from a flag: the words as they stand, and no shell.
 *
 * A flag's own quoting is the terminal's, so `--build "bun run build"` arrives
 * here as one value and becomes a program and its arguments. Nothing in that
 * value is re-read as quoting, and no shell is involved, so a compound line
 * belongs in a script the release folder carries rather than in a flag.
 */
const commandOf = (line: string | undefined): DeployCommand | undefined => {
  if (line === undefined) return undefined;
  const [command, ...args] = line.trim().split(/\s+/u).filter((word) => word !== '');
  if (command === undefined) return undefined;
  return args.length === 0 ? { command } : { command, args };
};

/** The one line a terminal gets, which says what happened and what is live now. */
const line = (result: DeployResult): string => {
  const at = result.sha === '' ? 'an unresolved version' : result.sha;
  const from = result.from === null ? 'nothing' : result.from;
  const outcome = result.outcome.state;
  const reason = 'reason' in result.outcome ? `: ${result.outcome.reason}` : '';
  return `${result.service}: ${from} -> ${at}, ${outcome}${reason}\n`;
};

/** Whether the outcome is a deploy the caller may act on as done, rather than one to look at. */
const settled = (result: DeployResult): boolean =>
  result.outcome.state === 'switched, checked' || result.outcome.state === 'switched, unchecked';

/** The request an AHP method wrote, or a stop naming what is wrong with the file. */
const readHanded = (file: string): { deployId: string; declaration: DeployDeclaration } => {
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    stop(`deploy cannot read the request file ${file}: ${(error as Error).message}`);
  }
  const body = held as { deployId?: unknown; declaration?: unknown };
  if (typeof body.deployId !== 'string' || body.deployId === '' || typeof body.declaration !== 'object' || body.declaration === null) {
    stop(`deploy: ${file} is not a request { deployId, declaration }`);
  }
  // Read once, then gone: the journal is the record from here on, and a copy lying about would be a second one.
  rmSync(file, { force: true });
  return { deployId: body.deployId, declaration: body.declaration as DeployDeclaration };
};

export const declareDeploy = (registry: Registry<object>): Command => registry.action({
  id: 'service.deploy',
  summary: 'Place a service at a version, by switching one current symlink',
  description: 'Fetches the version into a release folder from one object store per repository, builds and hooks it, switches one atomic rename, checks it, and says which of switched checked, switched unchecked, switched back or failed happened - or refuses by name when a deploy is already running.',
  surfaces: { cli: { pattern: ['deploy', ':service', ':version'] } },
  // What changes is what is live for this service on this machine.
  effect: 'change',
  resource: { kind: 'service', key: 'service' },
  scopes: ['config:write'],
  input: {
    service: { type: 'string', description: 'The service this machine runs; its state folder is under the host directory.' },
    version: { type: 'string', description: 'A branch, a tag or a commit sha of the declared repository.' },
    repo: { type: 'string', description: 'The repository the version is fetched from, and the one it must be reachable from. A path or a URL git can fetch.' },
    ref: { type: 'string', description: 'The ref the version must be reachable from when it is a sha. Defaults to main.' },
    migrations: { type: 'string', description: 'expand-only, the only value, and what permits an automatic switch-back after a failed check.' },
    build: { type: 'string', description: 'A command run in the new release folder, before anything switches.' },
    'before-switch': { type: 'string', description: 'A command run on the new release while current still points at the old one.' },
    check: { type: 'string', description: 'A command run after the switch. Without one the deploy answers switched, unchecked rather than healthy.' },
    keep: { type: 'integer', description: `Release folders to keep, current included. Defaults to ${String(DEFAULT_KEEP)}.` },
    'state-dir': { type: 'string', description: 'The directory the service state sits under. Defaults to the host configuration directory.' },
    request: { type: 'string', description: 'A file an AHP method handed the deploy through: its declaration and deploy id, so the words are never rebuilt from a line.' },
  },
  run: async (context) => {
    const service = context.value<string>('service');
    const version = context.value<string>('version');
    // The method's hand-off: a declaration and the id it already answered with, read rather than rebuilt from flags.
    const handedFile = context.optional<string>('request');
    const handed = handedFile === undefined ? undefined : readHanded(handedFile);
    if (handed !== undefined) {
      const result = await deploy({
        stateDir: context.optional<string>('state-dir') ?? configDir(),
        service,
        version,
        declaration: handed.declaration,
        deployId: handed.deployId,
        secrets: async (ref) => await fileVault({ file: vaultPath() }).get(ref),
      });
      const text = line(result);
      if (!settled(result)) conflict(text.trimEnd());
      return output(result, text);
    }
    const repo = context.optional<string>('repo');
    if (repo === undefined) {
      stop(`deploy takes the repository the version is fetched from: ahpd deploy ${service} ${version} --repo <path-or-url>`);
    }
    const migrations = context.optional<string>('migrations');
    if (migrations !== undefined && migrations !== 'expand-only') {
      stop(`deploy knows one migration value, expand-only; it was given ${migrations}`);
    }
    const keep = context.optional<number>('keep');
    const build = commandOf(context.optional<string>('build'));
    const beforeSwitch = commandOf(context.optional<string>('before-switch'));
    const check = commandOf(context.optional<string>('check'));
    const declaration: DeployDeclaration = {
      repo,
      ref: context.optional<string>('ref') ?? 'main',
      ...(migrations === undefined ? {} : { migrations: 'expand-only' }),
      ...(build === undefined ? {} : { build }),
      ...(beforeSwitch === undefined ? {} : { beforeSwitch }),
      ...(check === undefined ? {} : { check }),
      ...(keep === undefined ? {} : { keep }),
    };
    const result = await deploy({
      stateDir: context.optional<string>('state-dir') ?? configDir(),
      service,
      version,
      declaration,
      // A person at this terminal is the machine's owner, so no gate; the vault still is where a secret comes from,
      // read the same way `ahpd secrets exec` reads it so a build never carries a value in its line.
      secrets: async (ref) => await fileVault({ file: vaultPath() }).get(ref),
    });
    const text = line(result);
    if (!settled(result)) {
      // The line goes out first, so a script's stderr and a person's eyes see the same account of what happened.
      conflict(text.trimEnd());
    }
    return output(result, text);
  },
});
