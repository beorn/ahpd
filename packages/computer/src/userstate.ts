import { createHash } from 'node:crypto';
import { posix } from 'node:path';

/**
 * A dev container's user state: the volume it lives on, and the links into it.
 *
 * The state volume is a second volume beside the workspace's, mounted into the
 * container and named so that the Dev Container CLI's own `${devcontainerId}`
 * identifies it. The folders that hold the nested host's state and the agents'
 * sessions are moved onto it, or linked to what is already there, by a script
 * that runs as root before the host inside starts.
 *
 * Every name, label, target and progress token is VS Code's, so a volume made
 * here is the volume a window made for the same container.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/devContainerState.ts
 */

/** The label that names the dev container a state volume belongs to. */
export const STATE_VOLUME_ID_LABEL = 'vscode.dev-container-state.id';

/** The prefix of an id label kept on the state volume. */
export const STATE_VOLUME_LABEL_PREFIX = 'vscode.dev-container-state.label.';

/** The stable path in the container that links to the state folder. */
export const STATE_PATH = '/vscode-state';

/** The preferred target of the state volume, which also holds sibling folders. */
export const STATE_WORKSPACES_TARGET = '/workspaces';

/** The target used when a mount at `/workspaces` may conflict. */
export const STATE_FALLBACK_TARGET = '/.vscode-volume';

/** The folder directly under the state volume that holds the linked state. */
const STATE_FOLDER = '.vscode-state';

/** The layout version written into the state folder. */
const STATE_LAYOUT_VERSION = '1';

/** How much of the computed dev container id names a state volume. */
const STATE_VOLUME_ID_LENGTH = 12;

/** The longest folder part of a state volume's name. */
const STATE_VOLUME_FOLDER_LENGTH = 32;

/** The pattern a state volume's name matches. */
const STATE_VOLUME_PATTERN = /^vscode-state-(?:[a-z0-9][a-z0-9_.-]*-)?[0-9a-v]{12}$/;

/** Id labels that name a dev container's folder or repository, in order of preference. */
const FOLDER_ID_LABELS = ['vsch.local.repository.folder', 'vsch.local.repository', 'devcontainer.local_folder', 'vsch.local.folder', 'vsch.local.volume'];

/** The progress prefix the link script writes on stdout. */
const LINK_PROGRESS_PREFIX = 'vscode-state:';

/** The steps the link script reports. */
const LINK_STEPS = ['volume', 'stateFolder', 'statePath', 'stateLink', 'home', 'mountinfo', 'folders'];

/** The reasons the link script gives for not linking a folder. */
const LINK_SKIP_REASONS = ['parent', 'mounted', 'symlink', 'file', 'state', 'home', 'running'];

/**
 * The home folders a container keeps on its state volume.
 *
 * The nested host's own configuration, and the home folder of each agent this
 * build ships: Claude Code's `.claude`, pi's `.pi`, and cofold's configuration
 * under `.config`.
 */
export const USER_STATE_FOLDERS: readonly string[] = ['.config/ahpd', '.claude', '.pi', '.config/cofold'];

/** One command, as it exited and what it said. */
export interface StateCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** One program the state volume is made and read through. */
export type StateCommand = (argv: string[]) => Promise<StateCommandResult>;

/** What `docker inspect` reports for one mount. */
export interface ContainerMount {
  readonly Type: string;
  readonly Name?: string;
  readonly Destination: string;
}

/** The definition fields the state mount target is worked out from. */
export interface StateMountConfiguration {
  readonly dockerComposeFile?: unknown;
  readonly workspaceMount?: unknown;
  readonly mounts?: unknown;
  readonly runArgs?: unknown;
}

/** What the link script reported on stdout. */
export interface StateLinkProgress {
  /** The last step the script started, which is the failed step when it failed. */
  step?: string;
  homeFound: boolean;
  /** Folders whose state from an earlier container replaced the container's own folder. */
  restoredFolders: number;
  /** Folders moved from the container to the state volume. */
  movedFolders: number;
  createdFolders: number;
  /** Folders that were already linked. */
  existingFolders: number;
  skippedFolders: number;
  /** The sorted, comma-separated reasons for not persisting folders. */
  skipReasons: string;
}

/** The counts a link report carries. */
export interface StateLinkCounts {
  restoredFolders: number;
  movedFolders: number;
  createdFolders: number;
  existingFolders: number;
  skippedFolders: number;
  skipReasons: string;
}

/** The counts a link report adds to a notice, or nothing when it did not report. */
export const linkCounts = (progress: StateLinkProgress | undefined): Partial<StateLinkCounts> => progress === undefined ? {} : {
  restoredFolders: progress.restoredFolders,
  movedFolders: progress.movedFolders,
  createdFolders: progress.createdFolders,
  existingFolders: progress.existingFolders,
  skippedFolders: progress.skippedFolders,
  skipReasons: progress.skipReasons,
};

/** What the link script is given. */
export interface StateLinkOptions {
  /** Where the state volume is mounted in the container. */
  volumePath: string;
  /** The home folder whose state folders are linked. */
  homeFolder: string;
  uid: string;
  gid: string;
  /** The folders, relative to the home folder, to keep on the volume. */
  folders?: readonly string[];
  /**
   * Whether to keep folders that already exist rather than moving them.
   *
   * Set when the container was running before `up`, because a process may still
   * be using them.
   */
  keepExistingFolders?: boolean;
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
const checked = (answer: StateCommandResult, what: string): StateCommandResult => {
  if (answer.code === 0) return answer;
  const said = answer.stderr.trim() || answer.stdout.trim();
  throw new Error(`${what} failed: ${said === '' ? `exit ${String(answer.code)}` : said}`);
};

/** One word for `/bin/sh`, quoted as one. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Whether a path part is one a home folder may be named by. */
const isFolderName = (value: string): boolean => /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..';

/** The labels of an id-label list, as a map. */
const parseIdLabels = (idLabels: readonly string[]): Record<string, string> => {
  const labels: Record<string, string> = {};
  for (const pair of idLabels) {
    const at = pair.indexOf('=');
    if (at !== -1) labels[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return labels;
};

/**
 * The Dev Container CLI's `${devcontainerId}` for a container's id labels.
 *
 * The CLI hashes the labels as a sorted JSON object and writes the number in
 * base 32.
 */
export const devContainerId = (idLabels: readonly string[]): string => {
  const labels = parseIdLabels(idLabels);
  const hash = createHash('sha256').update(JSON.stringify(labels, Object.keys(labels).sort()), 'utf8').digest('hex');
  return BigInt(`0x${hash}`).toString(32).padStart(52, '0');
};

/** The state volume's name for a container's id labels. */
export const stateVolumeName = (idLabels: readonly string[]): string => {
  const labels = parseIdLabels(idLabels);
  const value = FOLDER_ID_LABELS.map((key) => labels[key]).find((one) => one !== undefined && one !== '');
  const baseName = value?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.replace(/\.git$/i, '');
  const folder = baseName
    ?.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .substring(0, STATE_VOLUME_FOLDER_LENGTH)
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return `vscode-state-${folder ? `${folder}-` : ''}${devContainerId(idLabels).slice(-STATE_VOLUME_ID_LENGTH)}`;
};

/**
 * The labels a state volume carries.
 *
 * The id label is what identifies the volume's container, and every id label is
 * kept prefixed so a tool that finds containers or repository volumes by them
 * ignores this volume. Additional labels are written as given, for the owner an
 * environment records.
 */
export const stateVolumeLabels = (idLabels: readonly string[], extra: readonly string[] = []): string[] => [
  `${STATE_VOLUME_ID_LABEL}=${devContainerId(idLabels)}`,
  ...idLabels.filter((label) => label.includes('=')).map((label) => `${STATE_VOLUME_LABEL_PREFIX}${label}`),
  ...extra,
];

/** Whether a volume's labels say it is the state volume of this dev container. */
export const isStateVolumeFor = (labels: unknown, idLabels: readonly string[]): boolean =>
  typeof labels === 'object' && labels !== null
  && (labels as Record<string, unknown>)[STATE_VOLUME_ID_LABEL] === devContainerId(idLabels);

/** The `--mount` value for a container's state volume. */
export const stateMount = (idLabels: readonly string[], target: string): string =>
  `type=volume,source=${stateVolumeName(idLabels)},target=${target},external=true`;

/** Make or find a dev container's state volume, with its labels. */
export const ensureStateVolume = async (
  docker: StateCommand,
  idLabels: readonly string[],
  extraLabels: readonly string[] = [],
): Promise<string> => {
  const name = stateVolumeName(idLabels);
  const volumes = checked(await docker(['volume', 'ls', '--format', '{{.Name}}']), 'docker volume ls');
  if (volumes.stdout.split(/\r?\n/).includes(name)) {
    const inspected = checked(await docker(['volume', 'inspect', '--format', '{{json .Labels}}', name]), `docker volume inspect ${name}`);
    if (!isStateVolumeFor(record(inspected.stdout), idLabels)) {
      throw new Error(`Docker volume ${name} is not the state volume of this dev container`);
    }
    return name;
  }
  checked(
    await docker(['volume', 'create', ...stateVolumeLabels(idLabels, extraLabels).flatMap((label) => ['--label', label]), name]),
    `docker volume create ${name}`,
  );
  return name;
};

/**
 * The target of the state volume.
 *
 * `/workspaces` is preferred, because a volume there also persists sibling
 * folders such as agent worktrees. Compose, a `workspaceMount` that is not a
 * folder under `/workspaces`, or a mount that may resolve to it puts a volume
 * there in conflict, so the fallback is used. Both targets in play is refused.
 */
export const stateMountTarget = (
  configuration: StateMountConfiguration,
  additionalMounts: readonly unknown[] = [],
): string => {
  const usesPath = (value: unknown, path: string): boolean => typeof value === 'string'
    && value.split(/[=:,\s]/).some((part) => part.startsWith('/') && normalizeMountTarget(part) === path);
  const mayUseWorkspaces = (value: unknown): boolean => typeof value === 'string'
    && (value.includes('${') || usesPath(value, STATE_WORKSPACES_TARGET));
  const mountTargets = [
    ...Array.isArray(configuration.mounts) ? configuration.mounts : [],
    ...additionalMounts,
  ].map((mount) => typeof mount === 'string'
    ? getMountTarget(mount) ?? mount
    : typeof mount === 'object' && mount !== null
      ? (mount as { readonly target?: unknown }).target
      : mount);
  const runArgs: readonly unknown[] = Array.isArray(configuration.runArgs) ? configuration.runArgs : [];
  const workspaceMountTarget = typeof configuration.workspaceMount === 'string' ? getMountTarget(configuration.workspaceMount) : undefined;
  if (
    configuration.dockerComposeFile !== undefined
    || (configuration.workspaceMount !== undefined
      && (!workspaceMountTarget
        || !normalizeMountTarget(workspaceMountTarget).startsWith(`${STATE_WORKSPACES_TARGET}/`)
        || workspaceMountTarget.includes('${')))
    || runArgs.some(mayUseWorkspaces)
    || mountTargets.some(mayUseWorkspaces)
  ) {
    if ([workspaceMountTarget, ...runArgs, ...mountTargets].some((value) => usesPath(value, STATE_FALLBACK_TARGET))) {
      throw new Error(`Both ${STATE_WORKSPACES_TARGET} and ${STATE_FALLBACK_TARGET} may already be mounted`);
    }
    return STATE_FALLBACK_TARGET;
  }
  return STATE_WORKSPACES_TARGET;
};

/** The class a state volume's target is reported as. */
export const stateTargetKind = (target: string): 'workspaces' | 'volume' =>
  target === STATE_WORKSPACES_TARGET ? 'workspaces' : 'volume';

/** The target of one mount string, when it names one. */
const getMountTarget = (mount: string): string | undefined => {
  for (const option of mount.split(',')) {
    const at = option.indexOf('=');
    if (at !== -1 && ['target', 'dst', 'destination'].includes(option.substring(0, at).trim())) {
      return option.substring(at + 1).trim();
    }
  }
  return undefined;
};

/** A mount destination normalized as Docker reads it. */
const normalizeMountTarget = (target: string): string => {
  const normalized = posix.normalize(target);
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

/** The state volume's mount in a container's mounts, when it has one. */
export const findStateMount = <T extends ContainerMount>(mounts: readonly T[]): T | undefined =>
  mounts.find((mount) => mount.Type === 'volume' && mount.Name !== undefined && mount.Name !== ''
    && STATE_VOLUME_PATTERN.test(mount.Name)
    && [STATE_WORKSPACES_TARGET, STATE_FALLBACK_TARGET].includes(normalizeMountTarget(mount.Destination)));

/** Whether a container state says its processes may be using its folders. */
export const isContainerRunning = (state: string): boolean =>
  ['running', 'paused', 'restarting'].includes(state.trim().toLowerCase());

/** The shell command that reads a container user's ids and home folder. */
export const STATE_USER_SCRIPT = 'id -u; id -g; printf "%s\\n" "$HOME"';

/** Whether a CLI stage's output carries a success result on its last result line. */
export const stageSucceeded = (stdout: string): boolean => {
  for (const line of stdout.trim().split('\n').reverse()) {
    let held: unknown;
    try { held = JSON.parse(line); }
    catch { continue; }
    if (typeof held !== 'object' || held === null || Array.isArray(held)) continue;
    if ((held as Record<string, unknown>).outcome === 'success') return true;
  }
  return false;
};

/**
 * The script that links a container's user state to its state volume.
 *
 * It runs as root before the nested host or any lifecycle command starts. A
 * folder with a mount at, above or inside it is already persisted and is
 * skipped; so is a folder that is a symlink, a file, or one whose parent is
 * not a folder. A folder that exists while the container was already running
 * is kept, because its process may still be using it.
 */
export const buildLinkCommand = (options: StateLinkOptions): string => {
  const { uid, gid } = options;
  const folders = options.folders ?? USER_STATE_FOLDERS;
  const volumePath = normalizeMountTarget(options.volumePath);
  const homeFolder = normalizeMountTarget(options.homeFolder);
  if (
    !posix.isAbsolute(volumePath)
    || volumePath === '/'
    || !posix.isAbsolute(homeFolder)
    || !/^\d+$/.test(uid)
    || !/^\d+$/.test(gid)
    || folders.length === 0
    || folders.some((folder) => folder.split('/').some((part) => !isFolderName(part)))
  ) {
    throw new Error('Invalid Dev Container state folder or user');
  }
  const link = (folder: string): string => {
    const segments = folder.split('/');
    const parents = segments.slice(1).map((_, at) => segments.slice(0, at + 1).join('/'));
    return `link_state ${[folder, ...parents].map(shellQuote).join(' ')}`;
  };
  return [
    'set -eu',
    'umask 022',
    `volume=${shellQuote(volumePath)}`,
    `home=${shellQuote(homeFolder)}`,
    `owner=${shellQuote(`${uid}:${gid}`)}`,
    `state_owner=${shellQuote(`0:${gid}`)}`,
    `keep_existing=${options.keepExistingFolders ? '1' : ''}`,
    `state="$volume/"${shellQuote(STATE_FOLDER)}`,
    `link_path=${shellQuote(STATE_PATH)}`,
    `progress() { echo ${shellQuote(LINK_PROGRESS_PREFIX)}"$1"; }`,
    'progress step:volume',
    'test ! -L "$volume"',
    'test -d "$volume"',
    'volume_real=$(cd -P "$volume" && pwd -P)',
    'progress step:stateFolder',
    'test ! -L "$state"',
    'test -d "$state" || mkdir "$state" || test -d "$state"',
    'cd -P "$state"',
    `if [ "$(pwd -P)" != "$volume_real/"${shellQuote(STATE_FOLDER)} ]; then echo "$state is not a folder on the volume" >&2; exit 1; fi`,
    'if [ "$(stat -c %u .)" != 0 ]; then echo "$state is not owned by root" >&2; exit 1; fi',
    'chown -h "$state_owner" .',
    'chmod 750 .',
    'locked=',
    'if command -v flock >/dev/null 2>&1; then exec 9<.; flock 9; locked=1; fi',
    `test -e .layout || printf '%s\\n' ${shellQuote(STATE_LAYOUT_VERSION)} > .layout`,
    'progress step:statePath',
    'if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then echo "$link_path exists and is not a symlink" >&2; exit 1; fi',
    'progress step:stateLink',
    'ln -sfnT "$state" "$link_path"',
    'progress step:home',
    'set_home() {',
    '  home_prefix=${1%/}',
    '  home_found=',
    '  if [ -d "$1" ]; then',
    '    home_real=$(cd "$1" && pwd -P)',
    '    home_real=${home_real%/}',
    '    home_found=1',
    '  fi',
    '}',
    'set_home "$home"',
    'if [ -z "$home_found" ]; then progress noHome; echo "Not persisting user state: home folder $home not found" >&2; exit 0; fi',
    'progress step:mountinfo',
    'test -r /proc/self/mountinfo',
    `mounts=$(cut -d' ' -f5 /proc/self/mountinfo | sed 's/\\\\040/ /g')`,
    'has_mount() {',
    '  while IFS= read -r mount; do',
    '    case "$mount" in',
    '      ""|/) ;;',
    '      "$1"|"$1"/*) return 0 ;;',
    '      *) case "$1" in "$mount"/*) return 0 ;; esac ;;',
    '    esac',
    '  done <<EOF',
    '$mounts',
    'EOF',
    '  return 1',
    '}',
    'is_other() { [ -L "$1" ] || { [ -e "$1" ] && [ ! -d "$1" ]; }; }',
    'skip() { progress "skip:$1"; echo "Not persisting ~/$rel: $2" >&2; }',
    'link_state() {',
    '  rel=$1',
    '  shift',
    '  src="$home_prefix/$rel"',
    '  dst="./$rel"',
    '  target="$link_path/$rel"',
    '  if [ -z "$home_found" ]; then skip home "home folder $home_prefix not found"; return 0; fi',
    '  for parent in "$@"; do',
    '    if is_other "$home_prefix/$parent" || is_other "./$parent"; then skip parent "~/$parent is not a folder"; return 0; fi',
    '  done',
    '  if has_mount "$home_real/$rel"; then skip mounted "it is already mounted"; return 0; fi',
    '  if [ -L "$src" ]; then',
    '    if [ "$(readlink "$src")" != "$target" ]; then skip symlink "it is a symlink"; return 0; fi',
    '  elif [ -e "$src" ] && [ ! -d "$src" ]; then',
    '    skip file "it is not a folder"; return 0',
    '  fi',
    '  if is_other "$dst"; then skip state "$state/$rel is not a folder"; return 0; fi',
    '  if [ -n "$keep_existing" ] && [ ! -L "$src" ] && [ -d "$src" ]; then',
    '    if [ -d "$dst" ]; then : > "$dst.deferred"; fi',
    '    skip running "it exists and the container was already running"; return 0',
    '  fi',
    '  for parent in "$@"; do',
    '    if [ ! -d "$home_prefix/$parent" ]; then',
    '      mkdir "$home_prefix/$parent" || test -d "$home_prefix/$parent"',
    '      chown -h "$owner" "$home_prefix/$parent"',
    '    fi',
    '    test -d "./$parent" || mkdir "./$parent" || test -d "./$parent"',
    '  done',
    '  result=existing',
    '  if [ ! -L "$src" ]; then',
    '    if [ -d "$dst" ]; then',
    '      result=restored',
    '      if [ -d "$src" ]; then',
    '        if [ -e "$dst.deferred" ]; then',
    '          copy=$(mktemp -d "$dst.deferred.XXXXXX")',
    '          cp -a "$src/." "$copy"',
    '          echo "Keeping the previous ~/$rel in $state/${copy#./}" >&2',
    '        fi',
    '        rm -rf "$src"',
    '      fi',
    '    elif [ -d "$src" ]; then',
    '      result=moved',
    '      if [ -n "$locked" ]; then rm -rf "$dst".moving.*; else rm -rf "$dst.moving.$$"; fi',
    '      cp -a "$src" "$dst.moving.$$"',
    '      mv "$dst.moving.$$" "$dst"',
    '      rm -rf "$src"',
    '    else',
    '      result=created',
    '    fi',
    '    rm -f "$dst.deferred"',
    '  fi',
    '  test -d "$dst" || mkdir "$dst" || test -d "$dst"',
    '  if [ "$(stat -c %u:%g "$dst")" != "$owner" ]; then chown -R "$owner" "$dst"; fi',
    '  if [ ! -L "$src" ]; then',
    '    ln -sT "$target" "$src" || test "$(readlink "$src")" = "$target"',
    '    echo "Persisting ~/$rel in $state/$rel" >&2',
    '  fi',
    '  progress "folder:$result"',
    '}',
    'progress step:folders',
    ...folders.map(link),
  ].join('\n');
};

/** What the link script reported on stdout. */
export const parseLinkOutput = (stdout: string): StateLinkProgress => {
  let step: string | undefined;
  let homeFound = true;
  const folders: Record<'restored' | 'moved' | 'created' | 'existing', number> = { restored: 0, moved: 0, created: 0, existing: 0 };
  let skippedFolders = 0;
  const skipReasons = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(LINK_PROGRESS_PREFIX)) continue;
    const [kind, value = ''] = line.substring(LINK_PROGRESS_PREFIX.length).split(':');
    if (kind === 'step' && LINK_STEPS.includes(value)) {
      step = value;
    }
    else if (kind === 'noHome') {
      homeFound = false;
    }
    else if (kind === 'skip') {
      skippedFolders++;
      skipReasons.add(LINK_SKIP_REASONS.includes(value) ? value : 'unknown');
    }
    else if (kind === 'folder' && (value === 'restored' || value === 'moved' || value === 'created' || value === 'existing')) {
      folders[value] += 1;
    }
  }
  return {
    ...(step === undefined ? {} : { step }),
    homeFound,
    restoredFolders: folders.restored,
    movedFolders: folders.moved,
    createdFolders: folders.created,
    existingFolders: folders.existing,
    skippedFolders,
    skipReasons: [...skipReasons].sort().join(','),
  };
};
