import { posix } from '../../../tools/posix.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { devContainer } from '../src/devcontainer.js';
import { isSandboxSupported, prepareSandboxOverride } from '../src/containersandbox.js';
import { sandboxRunArgs, sandboxSecurityOptions } from '../src/sandbox.js';
import { closeAll, keepingPort } from './support/closing.js';
import type { ContainerSink } from '../../sdk/src/types/containers.js';
import { PROCESS_CASE_MS } from '../../../tools/wait.ts';

// Each scripted CLI call is a process of its own: see `PROCESS_CASE_MS`.
vi.setConfig({ testTimeout: PROCESS_CASE_MS });

const CLI = fileURLToPath(new URL('./fixtures/devcontainer.mjs', import.meta.url));
const DOCKER = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('./fixtures/container-host.mjs', import.meta.url));
const IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu';

let root: string;
let state: string;
let dockerState: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-sandbox-'));
  state = join(root, 'cli.json');
  dockerState = join(root, 'docker.json');
});
afterEach(async () => {
  await closeAll();
  rmSync(root, { recursive: true, force: true });
});

/** A folder that is a dev container, with the definition a test names. */
function workspace(definition: Record<string, unknown> = { image: 'base' }): string {
  const folder = mkdtempSync(join(root, 'work-'));
  mkdirSync(join(folder, '.devcontainer'), { recursive: true });
  writeFileSync(join(folder, '.devcontainer', 'devcontainer.json'), JSON.stringify(definition));
  return folder;
}

it('appends the sandbox arguments to a definition, and writes them owner-only', async () => {
  const folder = workspace({ image: 'base', runArgs: ['--cap-add=SYS_PTRACE'] });
  const configPath = join(folder, '.devcontainer', 'devcontainer.json');
  const override = await prepareSandboxOverride({ configPath }, folder, {}, root);

  expect(override.args).toEqual(['--config', configPath, '--override-config', join(override.directory, 'devcontainer.json')]);
  expect(override.environment).toEqual({});
  const written = JSON.parse(readFileSync(join(override.directory, 'devcontainer.json'), 'utf8')) as { runArgs: string[] };
  expect(written.runArgs).toEqual(['--cap-add=SYS_PTRACE', ...sandboxRunArgs]);
  if (posix) expect(statSync(join(override.directory, 'devcontainer.json')).mode & 0o777).toBe(0o600);

  await override.remove();
  expect(existsSync(override.directory)).toBe(false);
});

it('writes a Compose service its security options and the tun device', async () => {
  const folder = workspace();
  const configPath = join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(join(folder, '.devcontainer', 'compose.yml'), 'version: "3.8"\nservices:\n  app:\n    image: base\n');
  const override = await prepareSandboxOverride({ configPath, service: 'app', dockerComposeFile: 'compose.yml' }, folder, {}, root);

  const written = JSON.parse(readFileSync(join(override.directory, 'devcontainer.json'), 'utf8')) as { dockerComposeFile: string[] };
  const composePath = join(override.directory, 'compose.json');
  expect(written.dockerComposeFile).toEqual(['compose.yml', composePath]);
  const compose = JSON.parse(readFileSync(composePath, 'utf8')) as { version: string; services: Record<string, unknown> };
  expect(compose).toEqual({
    version: '3.8',
    services: {
      app: {
        security_opt: [...sandboxSecurityOptions],
        devices: ['/dev/net/tun:/dev/net/tun:rw'],
      },
    },
  });
  if (posix) expect(statSync(composePath).mode & 0o777).toBe(0o600);
  await override.remove();
});

it('follows the CLI\'s Compose discovery when the definition names no files', async () => {
  const folder = workspace({ dockerComposeFile: [], service: 'app' });
  const configPath = join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(join(folder, 'docker-compose.yml'), 'services:\n  app:\n    image: base\n');
  const override = await prepareSandboxOverride({ configPath, service: 'app', dockerComposeFile: [] }, folder, {}, root);

  const written = JSON.parse(readFileSync(join(override.directory, 'devcontainer.json'), 'utf8')) as { dockerComposeFile: string[] };
  expect(written.dockerComposeFile).toEqual([]);
  expect(override.environment.COMPOSE_FILE?.split(delimiter)).toEqual([
    join(folder, 'docker-compose.yml'),
    join(override.directory, 'compose.json'),
  ]);
  await override.remove();
});

it('refuses a Compose definition with no service, and leaves no folder behind', async () => {
  const folder = workspace();
  const configPath = join(folder, '.devcontainer', 'devcontainer.json');
  writeFileSync(join(folder, 'docker-compose.yml'), 'services:\n  app:\n    image: base\n');

  await expect(prepareSandboxOverride({ configPath, dockerComposeFile: [] }, folder, {}, root)).rejects
    .toThrow('Sandboxing requires a Dev Container Compose configuration with files and a service.');
  expect(readdirSync(root).filter((name) => name.startsWith('ahpd-dev-container-sandbox-'))).toEqual([]);
});

it('reads the sandbox options from what Docker reports for the container', () => {
  const record = (host: Record<string, unknown>, appArmor = ''): string => JSON.stringify({
    AppArmorProfile: appArmor,
    HostConfig: {
      Privileged: false,
      SecurityOpt: [],
      MaskedPaths: [],
      ReadonlyPaths: [],
      Devices: [],
      ...host,
    },
  });
  const tun = { PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun', CgroupPermissions: 'rwm' };

  expect(isSandboxSupported(record({ SecurityOpt: [...sandboxSecurityOptions], Devices: [tun] }))).toBe(true);
  expect(isSandboxSupported(record({ Privileged: true }))).toBe(true);
  expect(isSandboxSupported(record({}))).toBe(false);
  expect(isSandboxSupported(record({ SecurityOpt: [...sandboxSecurityOptions], Devices: [tun] }, 'docker-default'))).toBe(false);
  expect(isSandboxSupported(record({ SecurityOpt: ['seccomp=unconfined'], Devices: [{ ...tun, CgroupPermissions: 'r' }] }))).toBe(false);
  expect(() => isSandboxSupported('{"HostConfig":null}')).toThrow('Invalid Docker sandbox configuration');
});

const wrote = (extra: Record<string, unknown> = {}): void => {
  // The host inside is present and run for real, so a relay stays up while the
  // test reads what the connect wrote.
  const held = { hostPresent: true, passthrough: [process.execPath], ...extra };
  writeFileSync(state, JSON.stringify({ calls: [], commands: [], ...held }));
  writeFileSync(dockerState, JSON.stringify({ machines: [], calls: [], ...held }));
};
const read = (): { calls: string[][] } => JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] };

function sink(): ContainerSink & { sandboxes: boolean[] } {
  const sandboxes: boolean[] = [];
  return {
    sandboxes,
    message: () => { /* the fake host is not under test */ },
    output: () => { /* the CLI's output is not under test */ },
    sandboxSupport: (supported) => { sandboxes.push(supported); },
    close: () => { /* the relay's end is not under test */ },
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
    environmentCache: join(root, 'environments'),
  });
  keepingPort(port);
  return port;
};

// POSIX-only: the scripted docker stands in for a Linux container by running
// the host inside with `/bin/sh` on this host.
it.skipIf(!posix)('runs up with the override, reports the container and removes the override after it', async () => {
  wrote();
  const folder = workspace();
  const where = sink();
  const port = launcher();
  const made = await port.connect({ connectionId: 'a', workspaceFolder: folder, name: 'Box', sandboxEnabled: true }, where);

  expect(made.sandboxSupported).toBe(true);
  expect(where.sandboxes).toEqual([true]);
  const up = read().calls.find((call) => call[0] === 'up') ?? [];
  expect(up).toEqual(expect.arrayContaining(['--config', join(folder, '.devcontainer', 'devcontainer.json')]));
  const at = up.indexOf('--override-config');
  expect(at).toBeGreaterThan(-1);
  const overridePath = up[at + 1] ?? '';
  const override = JSON.parse(readFileSync(overridePath, 'utf8')) as { runArgs: string[] };
  expect(override.runArgs).toEqual(sandboxRunArgs);

  await port.disconnect('a');
  expect(existsSync(dirname(overridePath))).toBe(false);
});

// POSIX-only: the scripted docker stands in for a Linux container by running
// the host inside with `/bin/sh` on this host.
it.skipIf(!posix)('reports a container asked for without the option as unsupported', async () => {
  wrote();
  const folder = workspace();
  const where = sink();
  const made = await launcher().connect({ connectionId: 'a', workspaceFolder: folder, name: 'Box' }, where);

  expect(made.sandboxSupported).toBe(false);
  expect(where.sandboxes).toEqual([false]);
  const up = read().calls.find((call) => call[0] === 'up') ?? [];
  expect(up).not.toContain('--override-config');
});

// POSIX-only: the scripted docker stands in for a Linux container by running
// the host inside with `/bin/sh` on this host.
it.skipIf(!posix)('puts the sandbox options in an environment configuration and reports them', async () => {
  wrote();
  const where = sink();
  const port = launcher();
  const made = await port.connectEnvironment!({
    connectionId: 'c-1',
    environmentId: 'env-1',
    image: IMAGE,
    name: 'Box',
    sandboxEnabled: true,
  }, where);

  expect(made.sandboxSupported).toBe(true);
  expect(where.sandboxes).toEqual([true]);
  const config = JSON.parse(readFileSync(join(root, 'environments', 'env-1', 'devcontainer.json'), 'utf8')) as { runArgs: string[] };
  expect(config.runArgs).toEqual(sandboxRunArgs);
});
