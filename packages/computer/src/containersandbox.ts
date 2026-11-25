import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { isMap, isScalar, parseDocument } from 'yaml';
import { sandboxRunArgs, sandboxSecurityOptions } from './sandbox.js';

/**
 * The sandbox options a dev container is made with, and the check of the
 * container that was made.
 *
 * A container keeps Docker's seccomp, AppArmor and system-path confinement
 * unless it is asked for the options the command sandbox needs. The options are
 * written beside a folder's definition as an override, or into its Compose
 * service's own file, and the answer is read back from the running container
 * rather than from the override, which an existing container may not have
 * applied.
 *
 * Every option and the check are VS Code's, so a container made here runs the
 * sandbox a window's container does.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/devContainerSandbox.ts
 */

/** The definition fields the override is worked out from, as the CLI read them. */
export interface SandboxConfiguration {
  /** The definition's own file, which the override is written from. */
  readonly configPath: string;
  /** The Compose service, when the definition is a Compose one. */
  readonly service?: string;
  /** The Compose files, when the definition is a Compose one; `[]` means the CLI discovers them. */
  readonly dockerComposeFile?: string | string[];
}

/** An override written for a connect, and how to take it away. */
export interface SandboxOverride {
  /** The CLI arguments that put the override beside the definition. */
  readonly args: readonly string[];
  /** Environment the CLI is run with, when the Compose files are discovered rather than named. */
  readonly environment: Record<string, string>;
  /** The folder holding the override, which is this host's own. */
  readonly directory: string;
  /** Remove the folder and its override. */
  remove(): Promise<void>;
}

/** Whether a path is a file, rather than a folder or nothing. */
const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  }
  catch {
    return false;
  }
};

/**
 * The Compose files the CLI finds when the definition names `[]`, by its own
 * discovery: `COMPOSE_FILE`, the workspace's `.env`, else `docker-compose.yml`
 * with the override beside it.
 */
const discoverComposeFiles = (workspaceFolder: string, environment: Record<string, string | undefined>): string[] => {
  let composeFile = environment.COMPOSE_FILE;
  if (composeFile === undefined || composeFile === '') {
    try {
      composeFile = /^COMPOSE_FILE=(.+)$/m.exec(readFileSync(join(workspaceFolder, '.env'), 'utf8'))?.[1]?.trim();
    }
    catch (error) {
      if (!['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  if (composeFile !== undefined && composeFile !== '') {
    return composeFile.split(delimiter).map((file) => resolve(workspaceFolder, file));
  }
  const override = resolve(workspaceFolder, 'docker-compose.override.yml');
  return [resolve(workspaceFolder, 'docker-compose.yml'), ...(isFile(override) ? [override] : [])];
};

/** A Compose file's `version`, which the CLI carries into its own overrides. */
const composeVersion = (source: string): string | undefined => {
  const document = parseDocument(/^\s*(version:.*)$/m.exec(source)?.[1] ?? source);
  if (!isMap(document.contents)) return undefined;
  const version = document.contents.get('version', true);
  return isScalar(version) ? String(version.value) : undefined;
};

/**
 * Write the sandbox override for a definition, and answer how to use it.
 *
 * For a folder's `devcontainer.json`, the options are appended to its
 * `runArgs`. For a Compose definition they are its service's `security_opt`
 * and `devices`, written as a Compose file of their own; where the definition
 * names `[]`, the CLI's discovery is followed and the files go to it as
 * `COMPOSE_FILE`, which keeps the workspace's `.env` reaching it.
 *
 * The directory is made here and holds only this override, so removing it
 * takes nothing else away.
 */
export const prepareSandboxOverride = async (
  configuration: SandboxConfiguration,
  workspaceFolder: string,
  environment: Record<string, string | undefined>,
  root: string = tmpdir(),
): Promise<SandboxOverride> => {
  const directory = await mkdtemp(join(root, 'ahpd-dev-container-sandbox-'));
  try {
    const errors: ParseError[] = [];
    const read: unknown = parse(readFileSync(configuration.configPath, 'utf8'), errors);
    if (errors.length > 0 || typeof read !== 'object' || read === null || Array.isArray(read)) {
      throw new Error(`Invalid Dev Container configuration: ${configuration.configPath}`);
    }
    const override: Record<string, unknown> = { ...read };
    let cliEnvironment: Record<string, string> = {};
    if (configuration.dockerComposeFile !== undefined) {
      const files = typeof configuration.dockerComposeFile === 'string'
        ? [configuration.dockerComposeFile]
        : configuration.dockerComposeFile;
      const service = configuration.service
        ?? (typeof override.service === 'string' ? override.service : undefined);
      if (typeof service !== 'string' || service === '') {
        throw new Error('Sandboxing requires a Dev Container Compose configuration with files and a service.');
      }
      const implicit = files.length === 0;
      const configured = implicit ? discoverComposeFiles(workspaceFolder, environment) : files;
      const first = configured[0];
      if (first === undefined) {
        throw new Error('Sandboxing requires a Dev Container Compose configuration with files and a service.');
      }
      const source = readFileSync(resolve(implicit ? workspaceFolder : dirname(configuration.configPath), first), 'utf8');
      const version = composeVersion(source);
      const composePath = join(directory, 'compose.json');
      await writeFile(composePath, JSON.stringify({
        ...(version === undefined ? {} : { version }),
        services: {
          [service]: {
            security_opt: [...sandboxSecurityOptions],
            devices: ['/dev/net/tun:/dev/net/tun:rw'],
          },
        },
      }), { mode: 0o600 });
      if (implicit) {
        cliEnvironment = { COMPOSE_FILE: [...configured, composePath].join(delimiter) };
      }
      else {
        override.dockerComposeFile = [...files, composePath];
      }
    }
    else {
      const held = override.runArgs;
      if (held !== undefined && (!Array.isArray(held) || held.some((one) => typeof one !== 'string'))) {
        throw new Error('Invalid Dev Container run arguments');
      }
      override.runArgs = [...(held ?? []), ...sandboxRunArgs];
    }
    const overridePath = join(directory, 'devcontainer.json');
    await writeFile(overridePath, JSON.stringify(override), { mode: 0o600 });
    return {
      args: ['--config', configuration.configPath, '--override-config', overridePath],
      environment: cliEnvironment,
      directory,
      remove: () => rm(directory, { recursive: true, force: true }),
    };
  }
  catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => { /* the refusal is the error worth raising */ });
    throw error;
  }
};

export { isSandboxSupported } from './sandbox.js';
