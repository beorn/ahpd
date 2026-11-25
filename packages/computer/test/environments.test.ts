import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { devContainer } from '../src/devcontainer.js';
import { ENVIRONMENT_OWNER_LABEL, devContainerId, environmentIdLabels, prepareEnvironment, removeEnvironment, stateVolumeName } from '../src/environments.js';
import { closeAll, keepingPort } from './support/closing.js';
import type { ContainerConnectResult, ContainerSink } from '../../sdk/src/types/containers.js';
import type { EnvironmentCommand, EnvironmentCommandResult, EnvironmentCommands } from '../src/environments.js';
import { PROCESS_CASE_MS, WAIT_MS } from '../../../tools/wait.ts';
import { posix } from '../../../tools/posix.ts';

// Each scripted CLI call is a process of its own: see `PROCESS_CASE_MS`.
vi.setConfig({ testTimeout: PROCESS_CASE_MS });

/*
 * Dev container environments: the volume a workspace lives in, and the
 * configuration the CLI is given to make the container around it.
 *
 * The commands are scripts here rather than fixtures, because what preparation
 * does with an answer - which name it takes, what it writes, what it gives to
 * the remote user - is the whole of it. The launcher's own connect is exercised
 * against the same fake CLI and Docker the other container cases use.
 */

const CLI = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));
const IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-environments-')); });
afterEach(async () => {
  await closeAll();
  rmSync(root, { recursive: true, force: true });
});

const answer = (stdout = ''): EnvironmentCommandResult => ({ code: 0, stdout, stderr: '' });

/** What one volume holds: its labels, and the folders a `run --rm` made in it. */
interface Volume { labels: Record<string, string>; folders: string[] }

/**
 * The two programs preparation runs, answering from a state a test can read.
 *
 * `volumes` is what Docker holds by name, `states` is what `ps -a` answers for
 * the environment's id labels, and `ups` and `execs` are what was asked of them.
 */
function scripted(start: { volumes?: Record<string, Volume>; states?: string[]; containers?: string[] } = {}): EnvironmentCommands & {
  volumes: Record<string, Volume>;
  states: string[];
  containers: string[];
  ups: string[][];
  execs: string[][];
  runs: string[][];
  calls: string[][];
} {
  const volumes = start.volumes ?? {};
  const states = start.states ?? [];
  const containers = start.containers ?? [];
  const ups: string[][] = [];
  const execs: string[][] = [];
  const runs: string[][] = [];
  const calls: string[][] = [];
  const docker: EnvironmentCommand = async (argv) => {
    calls.push(argv);
    if (argv[0] === 'volume' && argv[1] === 'ls') {
      const asked: string[] = [];
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--filter' && String(argv[i + 1]).startsWith('label=')) asked.push(String(argv[i + 1]).slice('label='.length));
      }
      const labelled = (labels: Record<string, string>, one: string): boolean => {
        const at = one.indexOf('=');
        return at === -1 ? Object.keys(labels).includes(one) : labels[one.slice(0, at)] === one.slice(at + 1);
      };
      return answer(Object.entries(volumes)
        .filter(([, volume]) => asked.every((label) => labelled(volume.labels, label)))
        .map(([name]) => `${name}\n`)
        .join(''));
    }
    if (argv[0] === 'volume' && argv[1] === 'create') {
      const labels = Object.fromEntries(argv.flatMap((one, at) => (argv[at - 1] === '--label' ? [[one.slice(0, one.indexOf('=')), one.slice(one.indexOf('=') + 1)]] : [])));
      const name = argv[argv.length - 1] ?? '';
      volumes[name] ??= { labels, folders: [] };
      return answer(`${name}\n`);
    }
    if (argv[0] === 'volume' && argv[1] === 'inspect') {
      const name = argv[argv.length - 1] ?? '';
      return answer(JSON.stringify(volumes[name]?.labels ?? null));
    }
    if (argv[0] === 'ps') return answer(argv.includes('--quiet') ? containers.join('\n') : states.join('\n'));
    if (argv[0] === 'run') {
      runs.push(argv);
      return answer();
    }
    if (argv[0] === 'exec') {
      execs.push(argv);
      return answer();
    }
    return answer();
  };
  const devcontainer: EnvironmentCommand = async (argv) => {
    ups.push(argv);
    const at = argv.indexOf('--override-config');
    const config = JSON.parse(readFileSync(argv[at + 1] ?? '', 'utf8')) as { workspaceFolder: string };
    return answer(`${JSON.stringify({
      outcome: 'success',
      containerId: 'c1',
      remoteUser: 'vscode',
      remoteWorkspaceFolder: config.workspaceFolder,
    })}\n`);
  };
  return { docker, devcontainer, volumes, states, containers, ups, execs, runs, calls };
}

it('makes the first free volume, a folder in it, and a configuration for the image', async () => {
  const commands = scripted();
  const cache = join(root, 'cache', 'env-1');
  const prepared = await prepareEnvironment({ environmentId: 'env-1', image: IMAGE }, cache, commands);

  expect(prepared).toEqual({
    containerId: 'c1',
    remoteWorkspaceFolder: '/workspaces/ubuntu',
    volumeName: 'ubuntu',
    idLabels: environmentIdLabels('ubuntu'),
  });
  expect(commands.volumes.ubuntu).toEqual({
    labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' },
    folders: [],
  });
  const config = JSON.parse(readFileSync(join(cache, 'devcontainer.json'), 'utf8')) as Record<string, unknown>;
  expect(config).toEqual({
    image: IMAGE,
    workspaceFolder: '/workspaces/ubuntu',
    workspaceMount: 'type=volume,source=ubuntu,target=/workspaces',
    updateRemoteUserUID: false,
  });
  // `0600` is a POSIX file mode. Windows keeps only a read-only flag.
  if (posix) expect(statSync(join(cache, 'devcontainer.json')).mode & 0o777).toBe(0o600);
  // The folder is made in the volume before the container starts.
  expect(commands.runs[0]).toEqual(expect.arrayContaining([
    'run', '--rm', '--entrypoint', 'mkdir', IMAGE, '-p', '/workspaces/ubuntu',
  ]));
  const up = commands.ups[0] ?? [];
  expect(up).toContain('--override-config');
  expect(up).not.toContain('--workspace-folder');
  expect(up).toEqual(expect.arrayContaining([
    '--id-label', 'vsc.devcontainer.volume.name=ubuntu',
    '--id-label', 'vsc.devcontainer.volume.folder=ubuntu',
  ]));
  // And the volume and the workspace are given to the image's user.
  expect(commands.execs[0]?.join(' ')).toContain('/workspaces/ubuntu');
  expect(commands.execs[0]).toEqual(expect.arrayContaining(['--user', 'root', '-w', '/', 'c1']));
});

it('finds the environment volume it made before, and does not make another', async () => {
  const commands = scripted({
    volumes: { ubuntu: { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' }, folders: ['/workspaces/ubuntu'] } },
    states: ['running'],
  });
  const prepared = await prepareEnvironment({ environmentId: 'env-1', image: IMAGE }, join(root, 'cache', 'env-1'), commands);

  expect(prepared.volumeName).toBe('ubuntu');
  expect(commands.calls.some((one) => one[0] === 'volume' && one[1] === 'create')).toBe(false);
  expect(commands.runs).toEqual([]);
  expect(prepared.idLabels).toEqual(environmentIdLabels('ubuntu'));
});

it('skips a name whose state volume exists, and takes the next one', async () => {
  const elsewhere = { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-2' }, folders: [] };
  const takenState = stateVolumeName(environmentIdLabels('ubuntu-2'));
  const commands = scripted({
    volumes: {
      ubuntu: elsewhere,
      [takenState]: { labels: {}, folders: [] },
    },
  });
  const prepared = await prepareEnvironment({ environmentId: 'env-1', image: IMAGE }, join(root, 'cache', 'env-1'), commands);

  expect(prepared.volumeName).toBe('ubuntu-3');
  expect(prepared.remoteWorkspaceFolder).toBe('/workspaces/ubuntu-3');
});

it('refuses an id that is not an environment id, and an image off the list', async () => {
  const commands = scripted();
  await expect(prepareEnvironment({ environmentId: 'Env_1', image: IMAGE }, join(root, 'cache', 'Env_1'), commands))
    .rejects.toThrow('Invalid Dev Container environment identifier: Env_1');
  await expect(prepareEnvironment({ environmentId: 'env-1', image: 'ubuntu:latest' }, join(root, 'cache', 'env-1'), commands))
    .rejects.toThrow('Unsupported Dev Container environment image: ubuntu:latest');
  expect(commands.calls).toEqual([]);
});

it('refuses a stopped environment without resume, and starts it when told to resume', async () => {
  const volume = { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' }, folders: ['/workspaces/ubuntu'] };
  const cache = join(root, 'cache', 'env-1');
  const stopped = scripted({ volumes: { ubuntu: volume }, states: ['exited'] });
  await expect(prepareEnvironment({ environmentId: 'env-1', image: IMAGE, name: 'Box' }, cache, stopped))
    .rejects.toThrow("Dev Container for 'Box' is stopped.");
  expect(stopped.ups).toEqual([]);

  const resumed = scripted({ volumes: { ubuntu: volume }, states: ['exited'] });
  const prepared = await prepareEnvironment({ environmentId: 'env-1', image: IMAGE, name: 'Box', resume: true }, cache, resumed);
  expect(prepared.volumeName).toBe('ubuntu');
  expect(resumed.ups).toHaveLength(1);
  // The folder is already in the volume, so nothing makes it again.
  expect(resumed.runs).toEqual([]);
});

it('removes an environment\'s containers, its volumes and its cached configuration', async () => {
  const idLabels = environmentIdLabels('ubuntu');
  const stateName = stateVolumeName(idLabels);
  const cache = join(root, 'cache', 'env-1');
  mkdirSync(cache, { recursive: true });
  const commands = scripted({
    volumes: {
      ubuntu: { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' }, folders: ['/workspaces/ubuntu'] },
      // A state volume made before it carried the environment's label, found by
      // the name its id computes and the id label it does carry.
      [stateName]: { labels: { 'vscode.dev-container-state.id': devContainerId(idLabels) }, folders: [] },
    },
    containers: ['c1', 'c2'],
  });

  await removeEnvironment('env-1', cache, commands.docker);

  expect(commands.calls).toEqual(expect.arrayContaining([
    ['rm', '--force', 'c1'],
    ['rm', '--force', 'c2'],
    ['volume', 'rm', 'ubuntu'],
    ['volume', 'rm', stateName],
  ]));
  expect(existsSync(cache)).toBe(false);
});

it('keeps a volume under the state name that belongs to another dev container', async () => {
  const idLabels = environmentIdLabels('ubuntu');
  const stateName = stateVolumeName(idLabels);
  const commands = scripted({
    volumes: {
      ubuntu: { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' }, folders: [] },
      [stateName]: { labels: { 'vscode.dev-container-state.id': devContainerId(environmentIdLabels('ubuntu-2')) }, folders: [] },
    },
  });

  await removeEnvironment('env-1', join(root, 'cache', 'env-1'), commands.docker);

  expect(commands.calls).not.toContainEqual(['volume', 'rm', stateName]);
  expect(commands.calls).toContainEqual(['volume', 'rm', 'ubuntu']);
});

it('writes the principal that made the volume, and refuses another on connect', async () => {
  const cache = join(root, 'cache', 'env-1');
  const commands = scripted();
  await prepareEnvironment({ environmentId: 'env-1', image: IMAGE, owner: 'user:ana' }, cache, commands);

  expect(commands.volumes.ubuntu?.labels).toEqual({
    'dev.container.volume': 'true',
    'vscode.agents.environment': 'env-1',
    [ENVIRONMENT_OWNER_LABEL]: 'user:ana',
  });
  await expect(prepareEnvironment({ environmentId: 'env-1', image: IMAGE, owner: 'user:beto' }, cache, commands))
    .rejects.toThrow("Dev Container environment 'env-1' was made by another user.");
});

it('lets anyone connect to a volume with no owner, and only the host remove it', async () => {
  const volume = { labels: { 'dev.container.volume': 'true', 'vscode.agents.environment': 'env-1' }, folders: ['/workspaces/ubuntu'] };
  const commands = scripted({ volumes: { ubuntu: volume }, states: ['running'] });
  const prepared = await prepareEnvironment({ environmentId: 'env-1', image: IMAGE, owner: 'user:ana' }, join(root, 'cache', 'env-1'), commands);
  expect(prepared.volumeName).toBe('ubuntu');

  const removing = scripted({ volumes: { ubuntu: volume }, containers: ['c1'] });
  await expect(removeEnvironment('env-1', join(root, 'cache', 'env-1'), removing.docker, 'user:ana'))
    .rejects.toThrow("Dev Container environment 'env-1' has no recorded owner, so only the host's own root connection may remove it.");
  expect(removing.calls).not.toContainEqual(['rm', '--force', 'c1']);

  const byRoot = scripted({ volumes: { ubuntu: volume }, containers: ['c1'] });
  await removeEnvironment('env-1', join(root, 'cache', 'env-1'), byRoot.docker, 'root:example.com');
  expect(byRoot.calls).toContainEqual(['volume', 'rm', 'ubuntu']);
});

/** A launcher over the state files a test already has, as a daemon started again is. */
function launcherAt(state: string, dockerState: string): ReturnType<typeof devContainer> {
  const port = devContainer({
    command: process.execPath,
    args: [CLI],
    docker: { command: process.execPath, args: [DOCKER], env: { DOCKER_FAKE_STATE: dockerState } },
    env: { DEVCONTAINER_FAKE_STATE: state, DOCKER_FAKE_STATE: dockerState },
    host: [process.execPath, HOST],
    plugins: ['@ahpd/agent-cofold'],
    environmentCache: join(root, 'environments'),
  });
  keepingPort(port);
  return port;
}

/**
 * The launcher against the scripted CLI and Docker, whose state files a test
 * reads for what was asked and what was left behind.
 */
function launcher(extra: Record<string, unknown> = {}): { port: ReturnType<typeof devContainer>; state: string; dockerState: string } {
  const state = join(root, 'cli.json');
  const dockerState = join(root, 'docker.json');
  writeFileSync(state, JSON.stringify({ calls: [], commands: [] }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], ...extra }));
  return { port: launcherAt(state, dockerState), state, dockerState };
}

/** A sink that keeps what the nested host said and the moment the relay ended. */
function sink(): ContainerSink & { said: string[]; closed: (string | undefined)[] } {
  const said: string[] = [];
  const closed: (string | undefined)[] = [];
  return { said, closed, message: (text) => { said.push(text); }, output: () => { /* watched by nobody here */ }, close: (why) => { closed.push(why); } };
}

const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

it('relays a host inside a container made from the environment image', async () => {
  const { port, state, dockerState } = launcher();
  const where = sink();
  const result = await port.connectEnvironment!(
    { connectionId: 'c-1', environmentId: 'env-1', image: IMAGE, name: 'Box' },
    where,
  ) as ContainerConnectResult;

  expect(result).toEqual({ address: 'devcontainer:abc123', remoteWorkspaceFolder: '/workspaces/ubuntu', sandboxSupported: false });
  const dockerHeld = JSON.parse(readFileSync(dockerState, 'utf8')) as {
    volumes: Record<string, Volume>;
    machines: { labels?: Record<string, string> }[];
  };
  expect(dockerHeld.volumes.ubuntu?.labels).toEqual({
    'dev.container.volume': 'true',
    'vscode.agents.environment': 'env-1',
  });
  expect(dockerHeld.machines[0]?.labels).toMatchObject({
    'vsc.devcontainer.volume.name': 'ubuntu',
    'vsc.devcontainer.volume.folder': 'ubuntu',
  });
  const cliHeld = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] };
  const up = cliHeld.calls.find((one) => one[0] === 'up') ?? [];
  expect(up).not.toContain('--workspace-folder');
  expect(up).toEqual(expect.arrayContaining(['--id-label', 'vsc.devcontainer.volume.name=ubuntu']));
  // `0600` is a POSIX file mode. Windows keeps only a read-only flag.
  if (posix) expect(statSync(join(root, 'environments', 'env-1', 'devcontainer.json')).mode & 0o777).toBe(0o600);
  // The host inside was started, which is what the relay carries.
  expect(where.said).toEqual([]);
});

// POSIX-only: the scripted docker stands in for a Linux container by running
// the relay with `/bin/sh` on this host.
it.skipIf(!posix)('closes every relay into an environment before removing it, and refuses it afterwards', async () => {
  const { port, dockerState } = launcher({ hostPresent: true, passthrough: [process.execPath] });
  const where = sink();
  await port.connectEnvironment!(
    { connectionId: 'c-1', environmentId: 'env-1', image: IMAGE, name: 'Box' },
    where,
  );
  await until(() => where.said.some((one) => one.includes('"method":"ready"')));

  expect(await port.removeEnvironment!('env-1')).toBe(true);
  // The relay's ending is the sink's, as any other ending is.
  expect(where.closed).toEqual([undefined]);
  const held = JSON.parse(readFileSync(dockerState, 'utf8')) as { machines: unknown[]; volumes: Record<string, unknown> };
  expect(held.machines).toEqual([]);
  expect(held.volumes.ubuntu).toBeUndefined();
  // The configuration folder went with the environment.
  expect(existsSync(join(root, 'environments', 'env-1'))).toBe(false);
  // And its id is not used again.
  await expect(port.connectEnvironment!(
    { connectionId: 'c-2', environmentId: 'env-1', image: IMAGE, name: 'Box' },
    sink(),
  )).rejects.toThrow("Dev Container 'Box' was deleted.");
});

it('refuses a removal by another principal, and keeps the environment', async () => {
  const { port, dockerState } = launcher({ hostPresent: true, passthrough: [] });
  await port.connectEnvironment!(
    { connectionId: 'c-1', environmentId: 'env-1', image: IMAGE, name: 'Box', owner: 'user:ana' },
    sink(),
  );

  await expect(port.removeEnvironment!('env-1', 'user:beto')).rejects
    .toThrow("Dev Container environment 'env-1' was made by another user.");
  const kept = JSON.parse(readFileSync(dockerState, 'utf8')) as { machines: unknown[]; volumes: Record<string, unknown> };
  expect(kept.volumes.ubuntu).toBeDefined();
  expect(kept.machines).toHaveLength(1);

  expect(await port.removeEnvironment!('env-1', 'user:ana')).toBe(true);
  expect((JSON.parse(readFileSync(dockerState, 'utf8')) as { volumes: Record<string, unknown> }).volumes.ubuntu).toBeUndefined();
});

it('reads the owner from the volume, so a launcher started again refuses another user', async () => {
  const first = launcher({ hostPresent: true, passthrough: [] });
  await first.port.connectEnvironment!(
    { connectionId: 'c-1', environmentId: 'env-1', image: IMAGE, name: 'Box', owner: 'user:ana' },
    sink(),
  );
  // The daemon restarted: a new launcher over the same Docker and cache folder.
  const again = launcherAt(first.state, first.dockerState);

  await expect(again.connectEnvironment!(
    { connectionId: 'c-2', environmentId: 'env-1', image: IMAGE, name: 'Box', owner: 'user:beto' },
    sink(),
  )).rejects.toThrow("Dev Container environment 'env-1' was made by another user.");
  await expect(again.removeEnvironment!('env-1', 'user:beto')).rejects
    .toThrow("Dev Container environment 'env-1' was made by another user.");
  const kept = JSON.parse(readFileSync(first.dockerState, 'utf8')) as { volumes: Record<string, { labels?: Record<string, string> }> };
  expect(kept.volumes.ubuntu?.labels?.[ENVIRONMENT_OWNER_LABEL]).toBe('user:ana');

  // The maker still reaches it, and may still remove it.
  await expect(again.connectEnvironment!(
    { connectionId: 'c-3', environmentId: 'env-1', image: IMAGE, name: 'Box', owner: 'user:ana' },
    sink(),
  )).resolves.toBeDefined();
  expect(await again.removeEnvironment!('env-1', 'user:ana')).toBe(true);
});

it('keeps an environment connectable when a removal fails', async () => {
  const { port } = launcher({
    hostPresent: true,
    passthrough: [],
    // A container this host did not make still mounts the workspace volume, and
    // Docker will not remove a volume in use.
    machines: [{ id: 'other', name: 'other', bare: true, labels: {}, mounts: ['ubuntu:/workspaces'] }],
  });
  await port.connectEnvironment!(
    { connectionId: 'c-1', environmentId: 'env-1', image: IMAGE, name: 'Box' },
    sink(),
  );

  await expect(port.removeEnvironment!('env-1')).rejects.toThrow('volume is in use');
  // The removed mark came off: the id is still an environment, not a deleted one.
  await expect(port.connectEnvironment!(
    { connectionId: 'c-2', environmentId: 'env-1', image: IMAGE, name: 'Box' },
    sink(),
  )).resolves.toBeDefined();
});
