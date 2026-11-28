import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EXIT_NO_IDENTITY, EXIT_NO_VALUE, EXIT_USAGE, readExecLine, secretsExec } from '../src/commands/secrets.js';

/*
 * #38277 slice 2: the secrets wrapper process-compose starts a program
 * through (@cto). A value reaches the child through its environment and
 * nowhere else; a reference with no value starts nothing and says which; a
 * vault file that is not there is refused by its path.
 */

const VALUE = 's3cr3t-test-value';
let dir: string;
let vault: string;
let report: string;
let started: string;
let said: string[];
let spawned: Array<{ file: string; args: readonly string[] }>;

/** A child that writes what it was started with: its argv, and the variable's value. */
const PROBE = `
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify({ argv: process.argv, value: process.env.TOKEN ?? null, parentArgv: fs.existsSync('/proc/' + process.ppid + '/cmdline') ? fs.readFileSync('/proc/' + process.ppid + '/cmdline', 'utf8') : null, tokenFile: process.env.HAB_ID_TOKEN_FILE ?? null, bearer: process.env.HAB_ID_TOKEN ?? null, serviceToken: process.env.AHPD_SERVICE_TOKEN_FILE ?? null }));
fs.writeFileSync(process.argv[3], 'ran');
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-secrets-exec-'));
  vault = join(dir, 'vault.json');
  report = join(dir, 'report.json');
  started = join(dir, 'started');
  writeFileSync(vault, JSON.stringify({ version: 1, secrets: { 'host:api-token': VALUE } }), { mode: 0o600 });
  writeFileSync(join(dir, 'probe.cjs'), PROBE);
  said = [];
  spawned = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const options = (extra: Record<string, unknown> = {}) => ({
  vaultFile: vault,
  machine: 'test-machine',
  stderr: (text: string) => { said.push(text); },
  // The real spawn, watched: what the shell was started with is what `ps` would show.
  spawn: ((file: string, args: readonly string[], opts: object) => {
    spawned.push({ file, args });
    return spawn(file, args, opts);
  }) as typeof spawn,
  forward: [],
  ...extra,
});

/** The probe's command line, as the driver would write the program's command. */
const command = (): string => `node ${join(dir, 'probe.cjs')} ${report} ${started}`;

it('reads the line the services driver writes', () => {
  expect(readExecLine(['web', '--env', 'TOKEN=host:api-token', '--env', 'OTHER=team:ops/key', '--', 'run && more'])).toEqual({
    service: 'web',
    env: [['TOKEN', 'host:api-token'], ['OTHER', 'team:ops/key']],
    command: 'run && more',
  });
  expect(readExecLine(['web', '--env', 'TOKEN=host:', '--', 'x'])).toMatch(/^web: --env TOKEN: host: is not a secret name/);
  expect(readExecLine(['web', '--env', 'TOKEN=host:a', 'x'])).toMatch(/^web: "x" is not --env/);
  expect(readExecLine(['web', '--', 'a', 'b'])).toMatch(/must be one quoted word/);
  expect(readExecLine(['web', '--env', 'T=host:a', '--env', 'T=host:b', '--', 'x'])).toBe('web: --env names T twice');
});

it('puts the value in the child\'s environment and nowhere in its argv or in anything it says', async () => {
  const end = await secretsExec(['web', '--env', 'TOKEN=host:api-token', '--', command()], options());

  expect(end).toEqual({ code: 0 });
  const seen = JSON.parse(readFileSync(report, 'utf8')) as { argv: string[]; value: string | null; parentArgv: string | null };
  expect(seen.value).toBe(VALUE);
  expect(JSON.stringify(seen.argv)).not.toContain(VALUE);
  // The shell between the wrapper and the program: its argv is the command, not the value.
  expect(spawned).toEqual([{ file: '/bin/sh', args: ['-c', command()] }]);
  expect(JSON.stringify(spawned)).not.toContain(VALUE);
  if (seen.parentArgv !== null) expect(seen.parentArgv).not.toContain(VALUE);
  expect(said.join('')).not.toContain(VALUE);
});

it('starts nothing when a reference has no value, and says which on which machine', async () => {
  const end = await secretsExec(['web', '--env', 'TOKEN=host:api-token', '--env', 'GONE=host:absent', '--', command()], options());

  expect(end).toEqual({ code: EXIT_NO_VALUE });
  expect(spawned).toEqual([]);
  expect(existsSync(started)).toBe(false);
  expect(said).toEqual(['ahpd secrets exec web: secret host:absent has no value on test-machine; nothing was started\n']);
  expect(said.join('')).not.toContain(VALUE);
});

it('refuses a vault file that is not there by its path, and starts nothing', async () => {
  rmSync(vault);
  const end = await secretsExec(['web', '--env', 'TOKEN=host:api-token', '--', command()], options());

  expect(end).toEqual({ code: EXIT_NO_VALUE });
  expect(spawned).toEqual([]);
  expect(existsSync(started)).toBe(false);
  expect(said).toEqual([`ahpd secrets exec web: no vault at ${vault} on test-machine, so host:api-token cannot be read; nothing was started\n`]);
});

it('refuses a vault that is not JSON without quoting it', async () => {
  writeFileSync(vault, `{"version":1,"secrets":{"host:api-token":"${VALUE}"`);
  const end = await secretsExec(['web', '--env', 'TOKEN=host:api-token', '--', command()], options());

  expect(end).toEqual({ code: EXIT_NO_VALUE });
  expect(existsSync(started)).toBe(false);
  expect(said.join('')).toContain(`${vault} is not a vault`);
  expect(said.join('')).not.toContain(VALUE);
});

it('refuses a line it cannot read and starts nothing', async () => {
  const end = await secretsExec(['web', '--env', 'TOKEN=host:api-token', command()], options());

  expect(end).toEqual({ code: EXIT_USAGE });
  expect(spawned).toEqual([]);
  expect(said[0]).toMatch(/^ahpd secrets exec: web: ".*" is not --env/);
});

it('answers the child\'s own exit code, and its signal', async () => {
  expect(await secretsExec(['web', '--', 'exit 7'], options())).toEqual({ code: 7 });
  expect(await secretsExec(['web', '--', 'kill -TERM $$'], options())).toEqual({ signal: 'SIGTERM' });
});

/*
 * #39156 B: a child runs as itself or not at all. The wrapper drops every identity the parent carries, mints the one
 * the child was declared with (hab signs; ahpd never does), and removes that token when the child ends. Until the
 * hab half lands, asking for a child identity refuses by name and starts nothing.
 */
const identityReport = (): Record<string, string | null> => JSON.parse(readFileSync(report, 'utf8')) as Record<string, string | null>;

it('reads --child, and refuses a repeated or malformed child name', () => {
  expect(readExecLine(['web', '--child', 'worker', '--', 'run'])).toEqual({ service: 'web', env: [], child: 'worker', command: 'run' });
  expect(readExecLine(['web', '--env', 'T=host:a', '--child=worker', '--', 'run'])).toEqual({
    service: 'web', env: [['T', 'host:a']], child: 'worker', command: 'run',
  });
  expect(readExecLine(['web', '--child', 'a', '--child', 'b', '--', 'run'])).toBe('web: --child names a child twice');
  expect(readExecLine(['web', '--child', 'not a name', '--', 'run'])).toBe('web: --child not a name is not a child name');
});

it('keeps the parent\'s identity for a start that names no child, so today\'s emitters still act as themselves', async () => {
  const end = await secretsExec(['web', '--', command()], options({
    environment: { ...process.env, HAB_ID_TOKEN: 'bearer-of-the-parent', HAB_ID_TOKEN_FILE: '/parent/token', AHPD_SERVICE_TOKEN_FILE: '/parent/service-token' },
  }));

  expect(end).toEqual({ code: 0 });
  const seen = identityReport();
  expect(seen['bearer']).toBe('bearer-of-the-parent');
  expect(seen['tokenFile']).toBe('/parent/token');
  expect(seen['serviceToken']).toBe('/parent/service-token');
});

it('never hands the parent\'s identity to a named child', async () => {
  const tokenFile = join(dir, 'child-token');
  writeFileSync(tokenFile, 'child-token-bytes', { mode: 0o600 });
  const end = await secretsExec(['web', '--child', 'worker', '--', command()], options({
    environment: { ...process.env, HAB_ID_TOKEN: 'bearer-of-the-parent', HAB_ID_TOKEN_FILE: '/parent/token', AHPD_SERVICE_TOKEN_FILE: '/parent/service-token' },
    mintChild: async () => ({ actor: 'worker', kind: 'service', tokenFile }),
  }));

  expect(end).toEqual({ code: 0 });
  const seen = identityReport();
  expect(seen['bearer']).toBeNull();
  expect(seen['tokenFile']).toBe(tokenFile);
  expect(seen['serviceToken']).toBeNull();
});

it('mints the child\'s identity, gives it only its own token file, and removes that file when the child ends', async () => {
  const tokenFile = join(dir, 'child-token');
  writeFileSync(tokenFile, 'child-token-bytes', { mode: 0o600 });
  const asked: Array<{ service: string; child: string }> = [];
  const end = await secretsExec(['web', '--child', 'worker', '--', command()], options({
    mintChild: async (request) => { asked.push({ ...request }); return { actor: 'worker', kind: 'service', tokenFile }; },
  }));

  expect(end).toEqual({ code: 0 });
  expect(asked).toEqual([{ service: 'web', child: 'worker' }]);
  expect(identityReport()['tokenFile']).toBe(tokenFile);
  expect(existsSync(tokenFile)).toBe(false);
});

it('starts nothing when the mint refuses the child, and says which child and why', async () => {
  const end = await secretsExec(['web', '--child', 'stranger', '--', command()], options({
    mintChild: async () => ({ refused: 'web: child stranger is not in the declaration the service publishes' }),
  }));

  expect(end).toEqual({ code: EXIT_NO_IDENTITY });
  expect(spawned).toEqual([]);
  expect(existsSync(started)).toBe(false);
  expect(said).toEqual(['ahpd secrets exec: web: child stranger is not in the declaration the service publishes; nothing was started\n']);
});

it('starts nothing when no mint is wired, rather than running as the parent', async () => {
  const end = await secretsExec(['web', '--child', 'worker', '--', command()], options());

  expect(end).toEqual({ code: EXIT_NO_IDENTITY });
  expect(spawned).toEqual([]);
  expect(existsSync(started)).toBe(false);
  expect(said.join('')).toContain('no hab signer is wired for a service\'s children');
});
