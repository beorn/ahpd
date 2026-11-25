import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { devContainer } from '../src/devcontainer.js';
import {
  USER_STATE_FOLDERS,
  buildLinkCommand,
  devContainerId,
  parseLinkOutput,
  stateMount,
  stateMountTarget,
  stateVolumeLabels,
  stateVolumeName,
} from '../src/userstate.js';
import { closeAll, keepingPort } from './support/closing.js';
import type { ContainerSink, ContainerUserState } from '../../sdk/src/types/containers.js';
import { PROCESS_CASE_MS } from '../../../tools/wait.ts';

// Each scripted CLI call is a process of its own: see `PROCESS_CASE_MS`.
vi.setConfig({ testTimeout: PROCESS_CASE_MS });

const CLI = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));

let root: string;
let state: string;
let dockerState: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-userstate-'));
  state = join(root, 'cli.json');
  dockerState = join(root, 'docker.json');
});
afterEach(async () => {
  await closeAll();
  rmSync(root, { recursive: true, force: true });
});

const LABELS = ['ahpd.computer=1', 'ahpd.devcontainer.folder=/home/me/Box'];

it('names the state volume as the Dev Container id does', () => {
  const name = stateVolumeName(LABELS);
  expect(name).toMatch(/^vscode-state-[0-9a-v]{12}$/);
  expect(name).toBe(`vscode-state-${devContainerId(LABELS).slice(-12)}`);
  // The same labels name the same volume on every connect.
  expect(stateVolumeName([...LABELS].reverse())).toBe(name);
  // Our id labels name no folder, so there is no folder part.
  expect(name).not.toContain('box');
});

it('labels the state volume with the id and each prefixed id label', () => {
  expect(stateVolumeLabels(LABELS)).toEqual([
    `vscode.dev-container-state.id=${devContainerId(LABELS)}`,
    'vscode.dev-container-state.label.ahpd.computer=1',
    'vscode.dev-container-state.label.ahpd.devcontainer.folder=/home/me/Box',
  ]);
  expect(stateVolumeLabels(LABELS, ['ahpd.environment.owner=person:one'])).toContain('ahpd.environment.owner=person:one');
});

it('mounts the state volume at /workspaces unless it may conflict', () => {
  expect(stateMountTarget({})).toBe('/workspaces');
  expect(stateMountTarget({ workspaceMount: 'type=bind,source=/work,target=/workspaces/Box' })).toBe('/workspaces');
  // Exactly /workspaces, Compose, or a mount that may resolve there.
  expect(stateMountTarget({ workspaceMount: 'type=volume,source=ubuntu,target=/workspaces' })).toBe('/.vscode-volume');
  expect(stateMountTarget({ dockerComposeFile: 'compose.yml' })).toBe('/.vscode-volume');
  expect(stateMountTarget({ runArgs: ['--mount', 'type=bind,source=${localWorkspaceFolder},target=/workspaces'] })).toBe('/.vscode-volume');
  // Both targets in play is refused.
  expect(() => stateMountTarget({
    dockerComposeFile: 'compose.yml',
    mounts: [{ type: 'volume', source: 'state', target: '/.vscode-volume' }],
  })).toThrow(/Both \/workspaces and \/\.vscode-volume/);
  expect(stateMount(LABELS, '/workspaces')).toContain(`source=${stateVolumeName(LABELS)},target=/workspaces,external=true`);
});

it('links the nested host and each agent session folder', () => {
  const command = buildLinkCommand({ volumePath: '/workspaces', homeFolder: '/home/me', uid: '1000', gid: '1000' });
  for (const folder of USER_STATE_FOLDERS) {
    expect(command).toContain(`link_state '${folder}'`);
  }
  expect(command).toContain("home='/home/me'");
  expect(command).toContain("owner='1000:1000'");
  expect(command).toContain('keep_existing=');
  expect(() => buildLinkCommand({ volumePath: '/', homeFolder: '/home/me', uid: '1000', gid: '1000' })).toThrow(/Invalid/);
  expect(() => buildLinkCommand({ volumePath: '/workspaces', homeFolder: '/home/me', uid: 'me', gid: '1000' })).toThrow(/Invalid/);
  expect(() => buildLinkCommand({ volumePath: '/workspaces', homeFolder: '/home/me', uid: '1000', gid: '1000', folders: ['../escape'] })).toThrow(/Invalid/);
});

it('reads what the link script did', () => {
  const progress = parseLinkOutput([
    'vscode-state:step:folders',
    'vscode-state:folder:restored',
    'vscode-state:folder:moved',
    'vscode-state:folder:created',
    'vscode-state:folder:created',
    'vscode-state:folder:existing',
    'vscode-state:skip:file',
    'vscode-state:skip:running',
    'vscode-state:skip:unknown',
  ].join('\n'));
  expect(progress).toEqual({
    step: 'folders',
    homeFound: true,
    restoredFolders: 1,
    movedFolders: 1,
    createdFolders: 2,
    existingFolders: 1,
    skippedFolders: 3,
    skipReasons: 'file,running,unknown',
  });
  const noHome = parseLinkOutput('vscode-state:noHome');
  expect(noHome.homeFound).toBe(false);
  expect(noHome.step).toBeUndefined();
});

/** A folder that is a dev container. */
function workspace(): string {
  const folder = mkdtempSync(join(root, 'work-'));
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), '{ "image": "base" }');
  return folder;
}

const USER_STATE_LINK_OUT = [
  'vscode-state:step:folders',
  ...USER_STATE_FOLDERS.map(() => 'vscode-state:folder:created'),
].join('\n');

const wrote = (extra: Record<string, unknown> = {}): void => {
  writeFileSync(state, JSON.stringify({ calls: [], commands: [], ...extra }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], ...extra }));
};
const read = (): { calls: string[][]; commands: string[] } =>
  JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][]; commands: string[] };
const ran = (): {
  calls: string[][];
  machines: { id?: string; name: string; labels?: Record<string, string>; state?: string }[];
  commands: { id: string; user?: string; workdir?: string; env: Record<string, string>; command: string[] }[];
} => (existsSync(dockerState)
  ? JSON.parse(readFileSync(dockerState, 'utf8'))
  : { calls: [], machines: [], commands: [] }) as never;

function sink(): ContainerSink & { userStates: ContainerUserState[]; closed: (string | undefined)[] } {
  const userStates: ContainerUserState[] = [];
  const closed: (string | undefined)[] = [];
  return {
    userStates,
    closed,
    message: () => { /* the fake host is not under test */ },
    output: () => { /* the CLI's output is not under test */ },
    userState: (notice) => { userStates.push(notice); },
    close: (why) => { closed.push(why); },
  };
}

const launcher = () => {
  const port = devContainer({
    command: process.execPath,
    args: [CLI],
    docker: { command: process.execPath, args: [DOCKER], env: { DOCKER_FAKE_STATE: dockerState } },
    env: { DEVCONTAINER_FAKE_STATE: state, DOCKER_FAKE_STATE: dockerState },
    host: [process.execPath, HOST],
    plugins: ['@ahpd/agent-cofold'],
  });
  keepingPort(port);
  return port;
};

it('reports the four stages, makes the volume and links it', async () => {
  wrote({ linkOut: USER_STATE_LINK_OUT });
  const folder = workspace();
  const where = sink();
  await launcher().connect({ connectionId: 'a', workspaceFolder: folder, name: 'Box', persistUserState: true }, where);

  // The four stages, in VS Code's order.
  expect(where.userStates.map((notice) => [notice.stage, notice.outcome])).toEqual([
    ['mount', 'added'],
    ['up', 'succeeded'],
    ['link', 'linked'],
    ['userCommands', 'succeeded'],
  ]);
  expect(where.userStates[0]).toMatchObject({ target: 'workspaces' });
  expect(where.userStates[2]).toMatchObject({
    target: 'workspaces',
    createdFolders: USER_STATE_FOLDERS.length,
    skippedFolders: 0,
  });

  const name = stateVolumeName([`ahpd.computer=1`, `ahpd.devcontainer.folder=${folder}`]);
  // The volume is made with the state labels.
  const created = ran().calls.find((call) => call[0] === 'volume' && call[1] === 'create');
  expect(created).toEqual(expect.arrayContaining([
    '--label', `vscode.dev-container-state.id=${devContainerId([`ahpd.computer=1`, `ahpd.devcontainer.folder=${folder}`])}`,
    '--label', 'vscode.dev-container-state.label.ahpd.computer=1',
    '--label', `vscode.dev-container-state.label.ahpd.devcontainer.folder=${folder}`,
    name,
  ]));
  // It is mounted at the preferred target, and lifecycle commands wait.
  const up = read().calls.find((call) => call[0] === 'up') ?? [];
  expect(up).toEqual(expect.arrayContaining(['--mount', `type=volume,source=${name},target=/workspaces,external=true`, '--skip-post-create']));
  // The link runs as root, with the home folder the container user has.
  const link = ran().commands.find((one) => one.command.join(' ').includes('vscode-state:'));
  expect(link?.user).toBe('root');
  expect(link?.command.join(' ')).toContain("home='/root'");
  // And the lifecycle commands run afterwards, by container id.
  expect(read().calls).toContainEqual(['run-user-commands', '--log-level', 'debug', '--container-id', 'abc123']);
});

it('links a container that already has a state volume with the setting off', async () => {
  wrote({ linkOut: USER_STATE_LINK_OUT });
  const folder = workspace();
  const one = launcher();
  await one.connect({ connectionId: 'a', workspaceFolder: folder, name: 'Box', persistUserState: true }, sink());

  const where = sink();
  await one.connect({ connectionId: 'b', workspaceFolder: folder, name: 'Box' }, where);

  // One stage only: the volume is there and is linked, but no new mount and no
  // lifecycle run are asked for with the setting off.
  expect(where.userStates.map((notice) => [notice.stage, notice.outcome])).toEqual([['link', 'linked']]);
  const up = read().calls.filter((call) => call[0] === 'up').at(-1) ?? [];
  expect(up).not.toContain('--skip-post-create');
  expect(up).not.toContain('--mount');
  expect(ran().calls.filter((call) => call[0] === 'volume' && call[1] === 'create')).toHaveLength(1);
  // A running container keeps the folders its processes may be using.
  const link = ran().commands.filter((one) => one.command.join(' ').includes('vscode-state:')).at(-1);
  expect(link?.command.join(' ')).toContain('keep_existing=1');
});
