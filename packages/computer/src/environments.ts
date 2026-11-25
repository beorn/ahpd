import { chmod, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEV_CONTAINER_ENVIRONMENT_IMAGES, isDevContainerEnvironmentId, type ContainerUserState, type Owner } from '@ahpd/sdk';
import { sandboxRunArgs } from './sandbox.js';
import {
  buildLinkCommand,
  devContainerId,
  ensureStateVolume,
  findStateMount,
  isContainerRunning,
  isStateVolumeFor,
  linkCounts,
  parseLinkOutput,
  stageSucceeded,
  stateMount,
  stateMountTarget,
  stateTargetKind,
  stateVolumeName,
  STATE_USER_SCRIPT,
  type ContainerMount,
  type StateLinkProgress,
} from './userstate.js';

/**
 * The names and labels VS Code gives an environment's state volume, re-exported
 * here because an environment's volumes are where this module's callers look.
 */
export { devContainerId, isStateVolumeFor, stateVolumeName };

/**
 * Dev container environments: a workspace in a Docker volume.
 *
 * An environment is not a folder's `devcontainer.json`. Its workspace lives in
 * a volume this module names and labels, and the container is made from an
 * image on the allowed list, so the workspace outlives the container and a
 * second connect reaches the same one. The volume's labels are the definition:
 * a name alone would not survive another environment making a volume beside it.
 *
 * The names, the labels and the state volume's computation are VS Code's, so a
 * container made here is the container its own window made for the same
 * environment.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/devContainerEnvironments.ts
 */

/** The label that names the environment a volume belongs to. */
export const ENVIRONMENT_LABEL = 'vscode.agents.environment';

/** The label of a volume that holds a dev container environment's workspace. */
export const ENVIRONMENT_VOLUME_LABEL = 'dev.container.volume';

/**
 * The label naming the principal that made the environment.
 *
 * Written when the volume is made, by the connect that made it, and read back
 * from the volume by every later connect and removal: the environment itself
 * carries whose it is, so a daemon started again answers as it did before.
 */
export const ENVIRONMENT_OWNER_LABEL = 'ahpd.environment.owner';

/** The id label naming the volume, given to `up` and to the container it makes. */
export const ENVIRONMENT_VOLUME_NAME_LABEL = 'vsc.devcontainer.volume.name';

/** The id label naming the folder in the volume, which here is the volume itself. */
export const ENVIRONMENT_VOLUME_FOLDER_LABEL = 'vsc.devcontainer.volume.folder';

/** Where the environment's volume is mounted, so its workspace is a folder under it. */
export const ENVIRONMENT_VOLUME_TARGET = '/workspaces';

/** One command, as it exited and what it said. */
export interface EnvironmentCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** One program the environment's preparation runs. */
export type EnvironmentCommand = (argv: string[]) => Promise<EnvironmentCommandResult>;

/** The two programs preparation reaches: Docker, and the Dev Container CLI. */
export interface EnvironmentCommands {
  /** Docker's own commands: volumes, `ps`, the folder and the ownership of it. */
  docker: EnvironmentCommand;
  /** The CLI's `up` and `run-user-commands`. */
  devcontainer: EnvironmentCommand;
  /** What each user state stage is told, when the caller reports them. */
  userState?: (notice: ContainerUserState) => void;
}

/** What preparation is asked for, beside the client's connection. */
export interface EnvironmentSource {
  environmentId: string;
  image: string;
  /** What the client calls the environment, for a refusal that names it. */
  name?: string;
  /** Whether a container that is stopped may be started again. */
  resume?: boolean;
  /** Whether the user's state is kept on a state volume. */
  persistUserState?: boolean;
  /** Whether the container runs with the options the command sandbox needs. */
  sandboxEnabled?: boolean;
  /** The principal the connect belongs to, which owns a volume it makes. */
  owner?: Owner;
}

/** An environment's prepared container and the volume its workspace is in. */
export interface PreparedEnvironment {
  containerId: string;
  /** The workspace folder inside the container. */
  remoteWorkspaceFolder: string;
  /** The volume that holds it, which removal takes away with the container. */
  volumeName: string;
  /** The id labels the container was made with, which name it in later commands. */
  idLabels: string[];
}

/** One JSON object from a command's output, or nothing. */
const record = (text: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  }
  catch { return undefined; }
};

/** A command that did not exit zero, with what it said. */
const checked = (answer: EnvironmentCommandResult, what: string): EnvironmentCommandResult => {
  if (answer.code === 0) return answer;
  const said = answer.stderr.trim() || answer.stdout.trim();
  throw new Error(`${what} failed: ${said === '' ? `exit ${String(answer.code)}` : said}`);
};

/** One word for `/bin/sh`, quoted as one. */
const quote = (word: string): string => `'${word.replace(/'/g, `'\\''`)}'`;

/**
 * The name New Dev Container proposes for an image: its tag, so the Ubuntu base
 * image makes a volume called `ubuntu`.
 */
const volumeBaseName = (image: string): string =>
  /:(?<variant>[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/.exec(image)?.groups?.variant ?? 'devcontainer';

/** The environment's id labels, which name the volume and its folder. */
export const environmentIdLabels = (volumeName: string): string[] => [
  `${ENVIRONMENT_VOLUME_NAME_LABEL}=${volumeName}`,
  `${ENVIRONMENT_VOLUME_FOLDER_LABEL}=${volumeName}`,
];

/**
 * Make a folder owner-only, and refuse one that is not a folder this user owns.
 *
 * The environment's configuration is written here, and its parent is in a place
 * every process on the machine can reach, so the mode is set on every use
 * rather than trusted from the create.
 */
export const prepareOwnerOnlyDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const found = await lstat(directory);
  if (found.isSymbolicLink() || !found.isDirectory()) {
    throw new Error(`${directory} is not a folder this host may keep an environment's configuration in`);
  }
  if (process.platform !== 'win32') await chmod(directory, 0o700);
};

/** Whether a container state from `docker ps` says the container may be used. */
const isEnvironmentRunning = (state: string): boolean =>
  ['running', 'paused', 'restarting'].includes(state.trim().toLowerCase());

/** The volumes that carry every one of these labels. */
const listVolumes = async (docker: EnvironmentCommand, labels: readonly string[] = []): Promise<string[]> => {
  const found = checked(
    await docker(['volume', 'ls', ...labels.flatMap((label) => ['--filter', `label=${label}`]), '--format', '{{.Name}}']),
    'docker volume ls',
  );
  return found.stdout.trim().split(/\r?\n/).filter((one) => one !== '');
};

/** A volume's labels, as Docker records them, or nothing when it has none. */
const volumeLabels = async (docker: EnvironmentCommand, volumeName: string): Promise<Record<string, unknown> | undefined> =>
  record(checked(await docker(['volume', 'inspect', '--format', '{{json .Labels}}', volumeName]), 'docker volume inspect').stdout.trim());

/** The principal a volume's labels name as the environment's maker, if they do. */
const recordedOwner = (labels: Record<string, unknown> | undefined): Owner | undefined => {
  const held = labels?.[ENVIRONMENT_OWNER_LABEL];
  return typeof held === 'string' && held !== '' ? held as Owner : undefined;
};

/**
 * Refuse a caller that is not the principal the environment was made by.
 *
 * Read from the volume rather than remembered beside this daemon, so a connect
 * or a removal after a restart is refused exactly as it was before one. A
 * volume with no owner label names no maker, and this has nothing to compare.
 */
const refuseAnotherOwner = (
  environmentId: string,
  labels: Record<string, unknown> | undefined,
  owner: Owner | undefined,
): void => {
  const made = recordedOwner(labels);
  if (made !== undefined && made !== owner) {
    throw new Error(`Dev Container environment '${environmentId}' was made by another user.`);
  }
};

/**
 * Refuse a removal of an environment whose maker was never recorded.
 *
 * The volume was made before the owner label existed, or by the reference
 * host, so nobody's name is on it: only the host's own root connection may
 * take it away, or the host itself on a host that names no users.
 */
const refuseOwnerlessRemoval = (
  environmentId: string,
  labels: Record<string, unknown> | undefined,
  owner: Owner | undefined,
): void => {
  if (recordedOwner(labels) !== undefined) return;
  if (owner !== undefined && !owner.startsWith('root:')) {
    throw new Error(`Dev Container environment '${environmentId}' has no recorded owner, so only the host's own root connection may remove it.`);
  }
};

/** Whether a volume carries the environment's label. */
const isEnvironmentVolume = async (docker: EnvironmentCommand, volumeName: string, environmentId: string): Promise<boolean> =>
  (await volumeLabels(docker, volumeName))?.[ENVIRONMENT_LABEL] === environmentId;

/** The environment's workspace volume, found by its labels rather than its name. */
const findEnvironmentVolume = async (docker: EnvironmentCommand, environmentId: string): Promise<string | undefined> =>
  (await listVolumes(docker, [`${ENVIRONMENT_VOLUME_LABEL}=true`, `${ENVIRONMENT_LABEL}=${environmentId}`]))[0];

/**
 * Make the environment's workspace volume under the first free name.
 *
 * `ubuntu`, then `ubuntu-2`, and so on, labelled with the principal the making
 * connect belongs to. A name whose state volume exists is not free: another
 * environment made it, and mounting this one's state over there would write
 * into a workspace that is not ours.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/devContainerEnvironments.ts
 */
const createEnvironmentVolume = async (
  docker: EnvironmentCommand,
  environmentId: string,
  image: string,
  existingVolumes: readonly string[],
  owner?: Owner,
): Promise<string> => {
  const base = volumeBaseName(image);
  const taken = new Set(existingVolumes);
  for (let index = 1; index <= 1000; index++) {
    const volumeName = index === 1 ? base : `${base}-${index}`;
    if (taken.has(volumeName) || taken.has(stateVolumeName(environmentIdLabels(volumeName)))) continue;
    checked(
      await docker([
        'volume', 'create',
        '--label', `${ENVIRONMENT_VOLUME_LABEL}=true`,
        '--label', `${ENVIRONMENT_LABEL}=${environmentId}`,
        ...(owner === undefined ? [] : ['--label', `${ENVIRONMENT_OWNER_LABEL}=${owner}`]),
        volumeName,
      ]),
      'docker volume create',
    );
    // Creating a volume that already exists succeeds without changing it, so an
    // environment made at the same time may own the name.
    if (await isEnvironmentVolume(docker, volumeName, environmentId)) return volumeName;
    taken.add(volumeName);
  }
  throw new Error('No free Docker volume name was found for the Dev Container environment.');
};

/** A caught error's sentence. */
const errorMessageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Link an environment's state folders to its state volume, when it has one.
 *
 * The mount is read off the running container, the user's ids and home folder
 * are read from the container, and the link script runs as root. A container
 * made without the state volume is reported as having no mount when the setting
 * is on, and is left alone when it is off.
 */
const linkEnvironmentState = async (
  containerId: string,
  remoteUser: string,
  persistUserState: boolean,
  keepExistingFolders: boolean,
  owner: Owner | undefined,
  commands: EnvironmentCommands,
): Promise<void> => {
  let reason = 'inspect';
  let target: 'workspaces' | 'volume' | undefined;
  let exitCode: number | undefined;
  let progress: StateLinkProgress | undefined;
  try {
    const inspected = checked(await commands.docker(['inspect', '--format', '{{json .Mounts}}', containerId]), 'docker inspect');
    const mounts: unknown = JSON.parse(inspected.stdout);
    const mount = findStateMount(Array.isArray(mounts) ? mounts as ContainerMount[] : []);
    if (mount === undefined) {
      if (persistUserState) commands.userState?.({ stage: 'link', outcome: 'noMount' });
      return;
    }
    target = stateTargetKind(mount.Destination);
    // The state volume names the same maker as the workspace volume, so
    // another user's connect never links it.
    reason = 'owner';
    const made = recordedOwner(await volumeLabels(commands.docker, mount.Name ?? ''));
    if (made !== undefined && made !== owner) {
      throw new Error(`Dev Container state volume ${mount.Name ?? ''} was made by another user.`);
    }
    reason = 'user';
    const user = await commands.docker(['exec', '--user', remoteUser, containerId, '/bin/sh', '-c', STATE_USER_SCRIPT]);
    exitCode = user.code;
    const [uid, gid, home] = user.stdout.trim().split(/\r?\n/);
    if (user.code !== 0 || uid === undefined || gid === undefined || home === undefined || uid === '' || gid === '' || home === '') {
      throw new Error(`Cannot read the Dev Container user (exit ${String(user.code)}): ${user.stderr.trim()}`);
    }
    reason = 'script';
    const linked = await commands.docker([
      'exec', '--user', 'root', '-w', '/', containerId, '/bin/sh', '-c',
      buildLinkCommand({ volumePath: mount.Destination, homeFolder: home, uid, gid, keepExistingFolders }),
    ]);
    exitCode = linked.code;
    progress = parseLinkOutput(linked.stdout);
    if (linked.code !== 0) {
      throw new Error(`Cannot link user state (exit ${String(linked.code)}): ${linked.stderr.trim() || linked.stdout.trim()}`);
    }
    commands.userState?.({
      stage: 'link',
      outcome: progress.homeFound ? 'linked' : 'homeNotFound',
      target,
      ...linkCounts(progress),
    });
  }
  catch (error) {
    if (!persistUserState && reason === 'inspect') return;
    commands.userState?.({
      stage: 'link',
      outcome: 'failed',
      reason,
      ...(progress?.step === undefined ? {} : { step: progress.step }),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(target === undefined ? {} : { target }),
      ...linkCounts(progress),
      errorMessage: errorMessageOf(error),
    });
  }
};

/**
 * Make or find an environment's container, keeping its workspace in its volume.
 *
 * The volume is found by its labels or made, the folder is created inside it
 * before the container starts, the container is made from `image` with the
 * volume at `/workspaces`, and the volume and folder are given to the remote
 * user so agent worktrees may be made beside the workspace.
 *
 * With `persistUserState`, a second volume is mounted for the folders the
 * nested host and its agents keep, `up` leaves its lifecycle commands for the
 * link step, and those commands run once the folders are linked.
 */
export const prepareEnvironment = async (
  source: EnvironmentSource,
  cacheDirectory: string,
  commands: EnvironmentCommands,
): Promise<PreparedEnvironment> => {
  if (!isDevContainerEnvironmentId(source.environmentId)) {
    throw new Error(`Invalid Dev Container environment identifier: ${source.environmentId}`);
  }
  if (!DEV_CONTAINER_ENVIRONMENT_IMAGES.includes(source.image)) {
    throw new Error(`Unsupported Dev Container environment image: ${source.image}`);
  }
  const existingVolumes = await listVolumes(commands.docker);
  const volumeName = await findEnvironmentVolume(commands.docker, source.environmentId)
    ?? await createEnvironmentVolume(commands.docker, source.environmentId, source.image, existingVolumes, source.owner);
  refuseAnotherOwner(source.environmentId, await volumeLabels(commands.docker, volumeName), source.owner);
  await prepareOwnerOnlyDirectory(cacheDirectory);
  const idLabels = environmentIdLabels(volumeName);
  const workspace = `${ENVIRONMENT_VOLUME_TARGET}/${volumeName}`;
  const containerStates = checked(
    await commands.docker([
      'ps', '-a', '--format', '{{.State}}',
      ...idLabels.flatMap((label) => ['--filter', `label=${label}`]),
    ]),
    'docker ps',
  ).stdout.split(/\r?\n/).filter((state) => state.trim() !== '');
  /*
   * A container that exists and is not up waits for a connect that says it may
   * be started, as a stopped folder's container does. `up` would start it
   * silently otherwise, and a client that believed the environment was down
   * would find it running under its feet.
   */
  if (containerStates.length > 0 && !containerStates.some(isEnvironmentRunning) && source.resume !== true) {
    throw new Error(`Dev Container for '${source.name ?? source.environmentId}' is stopped.`);
  }
  if (containerStates.length === 0) {
    // New Dev Container makes the workspace folder before the container, which
    // starts in it.
    checked(
      await commands.docker([
        'run', '--rm',
        '--mount', `type=volume,source=${volumeName},target=${ENVIRONMENT_VOLUME_TARGET}`,
        '--entrypoint', 'mkdir',
        source.image, '-p', workspace,
      ]),
      'mkdir',
    );
  }
  const persistUserState = source.persistUserState === true;
  let stateTarget: 'workspaces' | 'volume' | undefined;
  let keepExistingFolders = true;
  const mountArgs: string[] = [];
  /*
   * The state volume, mounted only into a container this connect makes: adding
   * a mount to an existing Compose container could make it again. The target
   * is the fallback because the workspace volume already occupies
   * `/workspaces`.
   */
  if (persistUserState) {
    let reason = 'config';
    try {
      const target = stateMountTarget({ workspaceMount: `type=volume,source=${volumeName},target=${ENVIRONMENT_VOLUME_TARGET}` });
      stateTarget = stateTargetKind(target);
      reason = 'listContainers';
      keepExistingFolders = containerStates.some(isContainerRunning);
      if (containerStates.length > 0) {
        commands.userState?.({ stage: 'mount', outcome: 'existingContainer', target: stateTarget });
      }
      else {
        reason = 'volume';
        const ownerLabels = source.owner === undefined ? [] : [`${ENVIRONMENT_OWNER_LABEL}=${source.owner}`];
        await ensureStateVolume(commands.docker, idLabels, ownerLabels);
        commands.userState?.({ stage: 'mount', outcome: 'added', target: stateTarget });
        mountArgs.push('--mount', stateMount(idLabels, target));
      }
    }
    catch (error) {
      commands.userState?.({
        stage: 'mount',
        outcome: 'failed',
        reason,
        ...(stateTarget === undefined ? {} : { target: stateTarget }),
        errorMessage: errorMessageOf(error),
      });
    }
  }
  const configPath = join(cacheDirectory, 'devcontainer.json');
  await writeFile(configPath, JSON.stringify({
    image: source.image,
    workspaceFolder: workspace,
    workspaceMount: `type=volume,source=${volumeName},target=${ENVIRONMENT_VOLUME_TARGET}`,
    // The volume is made for root and given to the remote user below; changing
    // the image user's ids to this host's would put the two out of step.
    updateRemoteUserUID: false,
    ...(source.sandboxEnabled === true ? { runArgs: [...sandboxRunArgs] } : {}),
  }), { mode: 0o600 });
  const up = await commands.devcontainer([
    'up', '--log-level', 'debug',
    '--override-config', configPath,
    ...idLabels.flatMap((label) => ['--id-label', label]),
    ...mountArgs,
    ...(persistUserState ? ['--skip-post-create'] : []),
  ]);
  const lines = up.stdout.trim().split(/\r?\n/);
  const result = record(lines[lines.length - 1] ?? '');
  const containerId = typeof result?.containerId === 'string' ? result.containerId : '';
  const remoteUser = typeof result?.remoteUser === 'string' ? result.remoteUser : '';
  const valid = up.code === 0
    && result?.outcome === 'success'
    && containerId !== ''
    && remoteUser !== ''
    && result.remoteWorkspaceFolder === workspace;
  if (persistUserState) {
    commands.userState?.(valid
      ? { stage: 'up', outcome: 'succeeded' }
      : { stage: 'up', outcome: 'failed', reason: up.code !== 0 ? 'exitCode' : 'result', exitCode: up.code, errorMessage: up.stdout.trim() || up.stderr.trim() });
  }
  if (!valid) {
    throw new Error('The Dev Container CLI returned an invalid environment container.');
  }
  const ownership = `chown "$(id -u ${quote(remoteUser)}):$(id -g ${quote(remoteUser)})" ${quote(ENVIRONMENT_VOLUME_TARGET)} ${quote(workspace)}`;
  checked(
    await commands.docker(['exec', '--user', 'root', '-w', '/', containerId, '/bin/sh', '-c', ownership]),
    'chown',
  );
  await linkEnvironmentState(containerId, remoteUser, persistUserState, keepExistingFolders, source.owner, commands);
  if (persistUserState) {
    const ran = await commands.devcontainer(['run-user-commands', '--log-level', 'debug', '--container-id', containerId]);
    const succeeded = ran.code === 0 && stageSucceeded(ran.stdout);
    commands.userState?.(succeeded
      ? { stage: 'userCommands', outcome: 'succeeded' }
      : { stage: 'userCommands', outcome: 'failed', reason: ran.code !== 0 ? 'exitCode' : 'result', exitCode: ran.code, errorMessage: ran.stdout.trim() || ran.stderr.trim() });
    if (!succeeded) {
      throw new Error(`Dev Container lifecycle commands failed: ${ran.stdout.trim() || ran.stderr.trim()}`);
    }
  }
  return {
    containerId,
    remoteWorkspaceFolder: workspace,
    volumeName,
    idLabels,
  };
};

/** Whether a volume is this environment's state volume, and not another's under the same name. */
const isEnvironmentStateVolume = async (
  docker: EnvironmentCommand,
  volumeName: string,
  idLabels: readonly string[],
  environmentId: string,
): Promise<boolean> => {
  const labels = await volumeLabels(docker, volumeName);
  // State volumes made before they carried the environment's label have none.
  return isStateVolumeFor(labels, idLabels)
    && (labels?.[ENVIRONMENT_LABEL] === undefined || labels[ENVIRONMENT_LABEL] === environmentId);
};

/**
 * The environment's volume, when its owner may be reached by this caller.
 *
 * The id is checked here because every road to the volume goes through it,
 * and the owner label before anything is made or taken away.
 */
const environmentVolumeFor = async (
  environmentId: string,
  docker: EnvironmentCommand,
  owner: Owner | undefined,
): Promise<string | undefined> => {
  if (!isDevContainerEnvironmentId(environmentId)) {
    throw new Error(`Invalid Dev Container environment identifier: ${environmentId}`);
  }
  const volumeName = await findEnvironmentVolume(docker, environmentId);
  if (volumeName === undefined) return undefined;
  const labels = await volumeLabels(docker, volumeName);
  refuseAnotherOwner(environmentId, labels, owner);
  refuseOwnerlessRemoval(environmentId, labels, owner);
  return volumeName;
};

/**
 * Refuse a caller that may not take this environment away, before anything is.
 *
 * A removal closes the relays into the environment before it takes the
 * container, so the check answers first: another principal's attempt must
 * leave the owner's relay running, and the volumes where they are.
 */
export const authorizeEnvironmentRemoval = async (
  environmentId: string,
  docker: EnvironmentCommand,
  owner?: Owner,
): Promise<void> => {
  await environmentVolumeFor(environmentId, docker, owner);
};

/**
 * Remove an environment's containers, its volumes, and its cached configuration.
 *
 * Its containers are found by the id labels of its workspace volume, which no
 * other volume has while that volume exists; its volumes are everything that
 * carries its environment label, and a state volume made before it carried the
 * label is found by its name and identity instead. The volume's owner label is
 * what authorises the removal, and it is read before anything is taken away.
 */
export const removeEnvironment = async (
  environmentId: string,
  cacheDirectory: string,
  docker: EnvironmentCommand,
  owner?: Owner,
): Promise<void> => {
  const volumeName = await environmentVolumeFor(environmentId, docker, owner);
  const volumes = new Set(await listVolumes(docker, [`${ENVIRONMENT_LABEL}=${environmentId}`]));
  if (volumeName !== undefined) {
    const idLabels = environmentIdLabels(volumeName);
    const containers = checked(
      await docker(['ps', '--all', '--quiet', ...idLabels.flatMap((label) => ['--filter', `label=${label}`])]),
      'docker ps',
    ).stdout.trim().split(/\r?\n/).filter((one) => one !== '');
    for (const container of containers) {
      checked(await docker(['rm', '--force', container]), 'docker rm');
    }
    const stateName = stateVolumeName(idLabels);
    if (
      !volumes.has(stateName)
      && (await listVolumes(docker)).includes(stateName)
      && await isEnvironmentStateVolume(docker, stateName, idLabels, environmentId)
    ) {
      volumes.add(stateName);
    }
  }
  for (const volume of volumes) {
    checked(await docker(['volume', 'rm', volume]), 'docker volume rm');
  }
  await rm(cacheDirectory, { recursive: true, force: true });
};
