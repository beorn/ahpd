import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRIVER } from '../src/channel.js';
import { putUnit, type SystemdMachine, type UnitRun } from '../src/systemd.js';

/*
 * #38277, @cto row 9: the second services driver is systemd --user units, behind
 * the same Driver and Machine. Every effect goes through an injected host, so no
 * unit is written and no systemctl runs on the machine running these tests.
 */

const UNIT_DIR = '/home/customer/.config/systemd/user';
const LOCAL = { principal: 'local:test', remote: false };
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

let files: Map<string, string>;
let runs: string[][];
let answer: UnitRun;
let configDir: string;
let machine: SystemdMachine;

beforeEach(() => {
  files = new Map();
  runs = [];
  answer = { code: 0, output: '' };
  // Only the remote-commands switch reads it; no config.json here means the switch is off.
  configDir = mkdtempSync(join(tmpdir(), 'ahpd-systemd-'));
  machine = {
    name: 'test-machine',
    configDir,
    changeLog: '/home/customer/.ahpd/boot/changes.jsonl',
    backend: {
      kind: 'systemd-user',
      unitDir: UNIT_DIR,
      host: {
        read: (path) => files.get(path),
        write: (path, text) => { files.set(path, text); },
        remove: (path) => { files.delete(path); },
        append: (path, text) => { files.set(path, `${files.get(path) ?? ''}${text}`); },
        run: (argv) => { runs.push([...argv]); return answer; },
      },
    },
  };
});
afterEach(() => rmSync(configDir, { recursive: true, force: true }));

const logLines = (): Array<Record<string, unknown>> =>
  (files.get(machine.changeLog) ?? '').trim().split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const UNIT = [
  '[Unit]',
  'Description=ahpd',
  '',
  '[Service]',
  'ExecStart=/opt/supervisor up -f "/home/customer name/pc.yaml"',
  'Restart=always',
  'RestartSec=2',
  '',
  '[Install]',
  'WantedBy=default.target',
  '',
].join('\n');

const AHPD = { name: 'ahpd', command: '/opt/supervisor up -f "/home/customer name/pc.yaml"', restart: { policy: 'always' as const, backoff_seconds: 2 } };

describe('the systemd-user arm writes, starts, stops and removes a user unit (#38277 row 9)', () => {
  // Requirement: put writes <unitDir>/<name>.service from the neutral record, through Driver.put, and logs the change.
  it('put creates the unit from the record, byte for byte, and logs it', async () => {
    const put = await DRIVER.put(machine, LOCAL, { service: AHPD, ifVersion: 'absent' });
    expect(put).toEqual({ ok: true, ifVersion: sha(UNIT), file: `${UNIT_DIR}/ahpd.service`, service: AHPD, changed: true });
    expect(files.get(`${UNIT_DIR}/ahpd.service`)).toBe(UNIT);
    expect(runs).toEqual([]);
    expect(logLines()).toEqual([expect.objectContaining({ principal: 'local:test', op: 'put', name: 'ahpd', after: AHPD, fileHashBefore: null, fileHashAfter: sha(UNIT) })]);
  });

  // Requirement: a put is pinned to the unit's version: create-only never overwrites, and a stale version writes nothing.
  it('put refuses an existing unit on create-only and a stale version, writing nothing', async () => {
    files.set(`${UNIT_DIR}/ahpd.service`, 'by hand\n');
    expect(await DRIVER.put(machine, LOCAL, { service: AHPD, ifVersion: 'absent' })).toMatchObject({ ok: false, code: 'EXISTS' });
    expect(await DRIVER.put(machine, LOCAL, { service: AHPD, ifVersion: sha('something else') })).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    expect(files.get(`${UNIT_DIR}/ahpd.service`)).toBe('by hand\n');
    const put = await DRIVER.put(machine, LOCAL, { service: AHPD, ifVersion: sha('by hand\n') });
    expect(put).toMatchObject({ ok: true, changed: true });
    // The same record again is no write, and says so.
    expect(await DRIVER.put(machine, LOCAL, { service: AHPD, ifVersion: sha(UNIT) })).toMatchObject({ ok: true, changed: false });
    expect(logLines().map((line) => line['refused'] === undefined ? 'ok' : (line['refused'] as { code: string }).code)).toEqual(['EXISTS', 'STALE_VERSION', 'ok', 'ok']);
  });

  // Requirement: a neutral field the unit cannot carry is refused by name, never dropped from what is written.
  it('put refuses a field the unit cannot carry, by name, and a command that would break out of ExecStart', async () => {
    const env = await DRIVER.put(machine, LOCAL, { service: { ...AHPD, cwd: '/srv' }, ifVersion: 'absent' });
    expect(env).toEqual({ ok: false, code: 'NOT_SUPPORTED', message: 'cwd is not supported by the systemd-user driver on test-machine' });
    const policy = await DRIVER.put(machine, LOCAL, { service: { ...AHPD, restart: { policy: 'exit_on_failure' } }, ifVersion: 'absent' });
    expect(policy).toMatchObject({ ok: false, code: 'NOT_SUPPORTED', message: expect.stringContaining('exit_on_failure') as unknown });
    const injected = await DRIVER.put(machine, LOCAL, { service: { name: 'ahpd', command: '/bin/true\nExecStartPre=/bin/evil' }, ifVersion: 'absent' });
    expect(injected).toMatchObject({ ok: false, code: 'INVALID' });
    expect(files.has(`${UNIT_DIR}/ahpd.service`)).toBe(false);
  });

  // Requirement: a caller may name the unit's Description= (the installer keeps what customers see in systemctl
  // status, @cto aed9c6e8); it defaults to the name, and a line break in it is refused before anything is written.
  it('put writes the description it is given as Description=, and refuses one that breaks the line', () => {
    const put = putUnit(machine, LOCAL, { service: AHPD, ifVersion: 'absent', description: 'ahpd (Hallohuman agent host), user session' });
    expect(put).toMatchObject({ ok: true, changed: true });
    expect(files.get(`${UNIT_DIR}/ahpd.service`)).toBe(UNIT.replace('Description=ahpd\n', 'Description=ahpd (Hallohuman agent host), user session\n'));
    const broken = putUnit(machine, LOCAL, { service: { ...AHPD, name: 'other' }, ifVersion: 'absent', description: 'two\nlines' });
    expect(broken).toMatchObject({ ok: false, code: 'INVALID' });
    expect(files.has(`${UNIT_DIR}/other.service`)).toBe(false);
  });

  // Requirement: a remote caller cannot write a unit's command while allowRemoteCommands is off, as in the process-compose arm.
  it('put refuses a remote caller while the machine takes no remote commands', async () => {
    const remote = await DRIVER.put(machine, { principal: 'plugin:hightea-pipe', remote: true }, { service: AHPD, ifVersion: 'absent' });
    expect(remote).toMatchObject({ ok: false, code: 'REMOTE_COMMANDS_OFF' });
    expect(files.has(`${UNIT_DIR}/ahpd.service`)).toBe(false);
  });

  // Requirement: start is `systemctl --user enable --now <unit>` and stop is `disable --now`, exactly, with no shell.
  it('control runs the exact systemctl argv and answers what it printed', async () => {
    answer = { code: 0, output: 'Created symlink default.target.wants/ahpd.service' };
    expect(await DRIVER.control(machine, LOCAL, { name: 'ahpd', verb: 'start' })).toEqual({ ok: true, name: 'ahpd', output: answer.output });
    answer = { code: 0, output: '' };
    expect(await DRIVER.control(machine, LOCAL, { name: 'ahpd', verb: 'stop' })).toEqual({ ok: true, name: 'ahpd', output: '' });
    expect(runs).toEqual([
      ['systemctl', '--user', 'enable', '--now', 'ahpd.service'],
      ['systemctl', '--user', 'disable', '--now', 'ahpd.service'],
    ]);
    expect(logLines().map((line) => line['op'])).toEqual(['start', 'stop']);
  });

  // Requirement: a systemctl that fails is a refusal carrying its own words, never a success.
  it('control refuses with systemctl\'s output when it exits non-zero', async () => {
    answer = { code: 1, output: 'Failed to enable unit: Unit file ahpd.service does not exist.' };
    const refused = await DRIVER.control(machine, LOCAL, { name: 'ahpd', verb: 'start' });
    expect(refused).toMatchObject({ ok: false, code: 'SYSTEMCTL_REFUSED', output: answer.output });
    if (!refused.ok) expect(refused.message).toBe(`start ahpd on test-machine: systemctl --user enable --now ahpd.service exited 1: ${answer.output}`);
    expect(logLines().at(-1)).toMatchObject({ op: 'start', refused: { code: 'SYSTEMCTL_REFUSED' } });
  });

  // Requirement: remove deletes the unit file, pinned to its version, and runs no systemctl.
  it('remove deletes the unit file against its version and runs nothing', async () => {
    files.set(`${UNIT_DIR}/ahpd.service`, UNIT);
    expect(await DRIVER.remove(machine, LOCAL, { name: 'ahpd', ifVersion: sha('older') })).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    expect(files.has(`${UNIT_DIR}/ahpd.service`)).toBe(true);
    expect(await DRIVER.remove(machine, LOCAL, { name: 'ahpd', ifVersion: sha(UNIT) })).toEqual({ ok: true, ifVersion: 'absent', file: `${UNIT_DIR}/ahpd.service` });
    expect(files.has(`${UNIT_DIR}/ahpd.service`)).toBe(false);
    expect(await DRIVER.remove(machine, LOCAL, { name: 'ahpd', ifVersion: sha(UNIT) })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(runs).toEqual([]);
    expect(logLines().map((line) => [line['op'], line['refused'] === undefined ? 'ok' : (line['refused'] as { code: string }).code]))
      .toEqual([['remove', 'STALE_VERSION'], ['remove', 'ok'], ['remove', 'NOT_FOUND']]);
  });

  // Requirement: a method the install path does not call is refused by its name, never half done.
  it('refuses list, logs, acknowledge, changes and restart by name', async () => {
    const said = (method: string) => ({ ok: false, code: 'NOT_SUPPORTED', message: `${method} is not supported by the systemd-user driver on test-machine` });
    expect(DRIVER.list(machine)).toEqual(said('list'));
    expect(await DRIVER.logs(machine, LOCAL, { name: 'ahpd' })).toEqual(said('logs'));
    expect(DRIVER.acknowledge(machine, LOCAL, { hashes: {} }, () => { throw new Error('nothing is recorded'); })).toEqual(said('acknowledge'));
    expect(DRIVER.changes(machine)).toEqual(said('changes'));
    expect(await DRIVER.control(machine, LOCAL, { name: 'ahpd', verb: 'restart' })).toEqual(said('restart'));
    expect(runs).toEqual([]);
    expect([...files.keys()]).toEqual([machine.changeLog]);
  });
});
