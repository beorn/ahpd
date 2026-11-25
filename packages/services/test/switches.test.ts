import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { machineSwitches } from '../src/switches.js';
import { daemonRootConfig } from '../../server/src/rootconfig.js';
import { optionsFrom } from '../../server/src/commands/options.js';
import { loadConfig } from '../../server/src/config.js';

/*
 * #38277 / #38271 (@cto 8033ccb4): allowRemoteCommands and allowRoomAsks are
 * set only on the machine. These cases prove the three things that ruling
 * rests on: both are off unless the file says otherwise, a switch the reader
 * cannot read is refused by name rather than read as off, and the protocol's
 * root config can neither see nor change them.
 */

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-machine-switches-'));
  file = join(dir, 'config.json');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const put = (value: unknown): void => { writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

describe('machineSwitches', () => {
  it('is off with no file, and off with a file that has no machine key', () => {
    expect(machineSwitches(dir)).toEqual({ allowRemoteCommands: false, allowRoomAsks: false });
    put({ port: 9187 });
    expect(machineSwitches(dir)).toEqual({ allowRemoteCommands: false, allowRoomAsks: false });
  });

  it('reads each switch, and a switch left out is off', () => {
    put({ machine: { allowRemoteCommands: true } });
    expect(machineSwitches(dir)).toEqual({ allowRemoteCommands: true, allowRoomAsks: false });
    put({ machine: { allowRemoteCommands: false, allowRoomAsks: true } });
    expect(machineSwitches(dir)).toEqual({ allowRemoteCommands: false, allowRoomAsks: true });
  });

  it('reads the file again on every call, so a local edit needs no restart', () => {
    put({ machine: { allowRemoteCommands: true } });
    expect(machineSwitches(dir).allowRemoteCommands).toBe(true);
    put({ machine: { allowRemoteCommands: false } });
    expect(machineSwitches(dir).allowRemoteCommands).toBe(false);
  });

  it('refuses a misspelt switch, a non-boolean value and a malformed file by name, never reading them as off', () => {
    put({ machine: { allowRemoteComands: true } });
    expect(() => machineSwitches(dir)).toThrow(/"machine\.allowRemoteComands" .* is not a switch; the switches are allowRemoteCommands, allowRoomAsks/);
    put({ machine: { allowRoomAsks: 'yes' } });
    expect(() => machineSwitches(dir)).toThrow(/"machine\.allowRoomAsks" .* must be true or false/);
    put({ machine: true });
    expect(() => machineSwitches(dir)).toThrow(/"machine" .* must be an object/);
    put('{ not json');
    expect(() => machineSwitches(dir)).toThrow(/is not JSON/);
  });
});

describe('the machine key and the protocol', () => {
  it('loads with the daemon: a config.json carrying it starts as before', () => {
    put({ port: 9187, machine: { allowRemoteCommands: true, allowRoomAsks: true } });
    expect(() => loadConfig(file)).not.toThrow();
  });

  it('is not a key root config serves, so no client can read or write it', async () => {
    put({ port: 9187, host: '127.0.0.1', machine: { allowRemoteCommands: true } });
    const root = daemonRootConfig(optionsFrom({ configFile: file }));
    expect(Object.keys(root.schema())).not.toContain('machine');
    expect(Object.keys(await root.values())).not.toContain('machine');
  });

  it('survives a client writing other keys, unchanged', async () => {
    put({ port: 9187, host: '127.0.0.1', machine: { allowRemoteCommands: true, allowRoomAsks: false } });
    const root = daemonRootConfig(optionsFrom({ configFile: file }));
    await root.write({ port: 9300 });
    const after = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(after['port']).toBe(9300);
    expect(after['machine']).toEqual({ allowRemoteCommands: true, allowRoomAsks: false });
    expect(machineSwitches(dir)).toEqual({ allowRemoteCommands: true, allowRoomAsks: false });
  });
});
