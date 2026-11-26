/*
 * The Windows update: the hand-off out of the install, and the helper's steps.
 *
 * On Windows the daemon holds a native `node-pty` binding, so npm cannot
 * replace the package while it runs; the update stops, and a helper outside the
 * install does the install. No case here starts a process: the hand-off's
 * starter and the helper's runner are the facts both take, so the pid, the npm
 * call, the plugin move and the start are all recorded rather than run. The
 * helper itself is a fixture file, copied as a build of it would be.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handOffToHelper } from '../src/selfupdate.js';
import type { Starter } from '../src/selfupdate.js';
import { updateOnce } from '../src/updater.js';
import type { HelperFacts, HelperManifest, HelperRunOptions } from '../src/updater.js';

/** Where a Windows npm install of ahpd puts the package, as `packageEntry` reads it. */
const PREFIX = 'C:\\npm-prefix';
const ENTRY = `${PREFIX}\\node_modules\\@ahpd\\server\\dist\\main.js`;
const CONFIG = 'C:\\cfg\\ahpd';
const LOG = `${CONFIG}\\daemon.log`;
const LINE = ['--port', '9350'];
const VERSION = '99.0.0';

let home: string;

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-windows-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A build of the helper where the package's own `dist` would have one. */
const HELPER = 'export const helper = true;\n';

/** One step the helper ran, as its runner was given it. */
interface Call {
  program: string;
  args: string[];
  options: HelperRunOptions;
}

/** The steps of a helper whose daemon goes after `alive` says so. */
const factsOf = (alive: readonly boolean[], answered: (call: Call) => { code: number; stdout: string; stderr: string } = () => ({ code: 0, stdout: '', stderr: '' })): {
  facts: HelperFacts;
  calls: Call[];
  said: string[];
  ticks: () => number;
} => {
  const left = [...alive];
  const calls: Call[] = [];
  const said: string[] = [];
  let ticks = 0;
  return {
    facts: {
      alive: () => left.shift() ?? false,
      wait: async () => { ticks += 1; },
      now: () => ticks * 1000,
      run: async (program, args, options) => {
        const call = { program, args: [...args], options };
        calls.push(call);
        return answered(call);
      },
      log: (line) => { said.push(line); },
    },
    calls,
    said,
    ticks: () => ticks,
  };
};

/** What the hand-off wrote beside the copy of the helper, as the helper reads it. */
const manifestIn = (folder: string): HelperManifest => JSON.parse(readFileSync(join(folder, 'update.json'), 'utf8')) as HelperManifest;

describe('the hand-off', () => {
  it('copies the helper out of the install and passes the pid and the line', async () => {
    const built = join(home, 'install', 'dist');
    mkdirSync(built, { recursive: true });
    const helper = join(built, 'updater.js');
    writeFileSync(helper, HELPER);
    const temporary = join(home, 'tmp');
    mkdirSync(temporary, { recursive: true });
    const started: { command: string; args: string[]; options: Parameters<Starter>[2] }[] = [];
    let unrefs = 0;
    const start: Starter = (command, args, options) => {
      started.push({ command, args, options });
      return { unref: () => { unrefs += 1; } };
    };

    const made = await handOffToHelper({
      pid: 4242,
      place: { kind: 'global', prefix: PREFIX },
      version: VERSION,
      configDir: CONFIG,
      line: LINE,
      log: LOG,
      platform: 'win32',
      npmVersion: async () => '11.15.0',
      helper,
      tmp: temporary,
      start,
    });

    // The copy, not the built file npm is about to replace, is what runs.
    expect(made.folder.startsWith(temporary)).toBe(true);
    expect(made.helper).toBe(join(made.folder, 'updater.mjs'));
    expect(made.helper).not.toBe(helper);
    expect(existsSync(made.helper)).toBe(true);
    expect(readFileSync(made.helper, 'utf8')).toBe(HELPER);

    const manifest = manifestIn(made.folder);
    expect(manifest.pid).toBe(4242);
    expect(manifest.line).toEqual(LINE);
    expect(manifest.entry).toBe(ENTRY);
    expect(manifest.configDir).toBe(CONFIG);
    expect(manifest.version).toBe(VERSION);
    expect(manifest.log).toBe(LOG);

    // npm is the daemon's own call, whether it is npm by name or npm's `.js`
    // through this Node, and the arguments are read without their shell quotes.
    const argv = manifest.npm.args.map((one) => one.replace(/^"|"$/gu, ''));
    expect(argv).toContain('-g');
    expect(argv).toContain(`@ahpd/server@${VERSION}`);
    expect(argv[argv.indexOf('--prefix') + 1]).toBe(PREFIX);

    // Detached, hidden, in the copy's own folder, with its streams let go and
    // the process let go of, so the daemon can stop without waiting for it.
    expect(started).toHaveLength(1);
    expect(started[0]?.command).toBe(process.execPath);
    expect(started[0]?.args).toEqual([made.helper, join(made.folder, 'update.json')]);
    expect(started[0]?.options).toEqual({ cwd: made.folder, detached: true, stdio: 'ignore', windowsHide: true });
    expect(unrefs).toBe(1);
  });
});

describe('the helper', () => {
  const manifest = (over: Partial<HelperManifest> = {}): HelperManifest => ({
    pid: 4242,
    npm: { command: 'npm', args: ['install', '-g', '--prefix', PREFIX, `@ahpd/server@${VERSION}`], shell: false },
    entry: ENTRY,
    configDir: CONFIG,
    version: VERSION,
    line: LINE,
    cwd: CONFIG,
    log: LOG,
    waitMs: 60_000,
    ...over,
  });

  it('waits for the daemon, runs npm, and starts the daemon with the recorded line', async () => {
    // The daemon is there for two looks, then gone.
    const { facts, calls, said, ticks } = factsOf([true, true, false]);

    expect(await updateOnce(manifest(), facts)).toBe(0);
    expect(ticks()).toBe(2);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.program).toBe('npm');
    expect(calls[0]?.args).toEqual(['install', '-g', '--prefix', PREFIX, `@ahpd/server@${VERSION}`]);
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.cwd).toBe(CONFIG);

    // The plugins move with the binary npm just installed, and the plugin root
    // is the daemon's own folder rather than whatever this environment names.
    expect(calls[1]?.program).toBe(process.execPath);
    expect(calls[1]?.args).toEqual([ENTRY, 'plugin', 'update', 'all']);
    expect(calls[1]?.options.env?.AHPD_PLUGIN_ROOT).toContain('node_modules');

    expect(calls[2]?.program).toBe(process.execPath);
    expect(calls[2]?.args).toEqual([ENTRY, 'start', ...LINE]);

    expect(said.join('\n')).toContain('waiting for pid 4242 to stop');
    expect(said.join('\n')).toContain(`installed @ahpd/server@${VERSION}`);
    expect(said.join('\n')).toContain('the daemon is up');
  });

  it('starts the old line again when npm fails, and writes the error to the log', async () => {
    const { facts, calls, said } = factsOf([false], (call) => (call.program === 'npm'
      ? { code: 1, stdout: '', stderr: 'EACCES: permission denied\n' }
      : { code: 0, stdout: '', stderr: '' }));

    expect(await updateOnce(manifest(), facts)).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args).toEqual([ENTRY, 'start', ...LINE]);
    expect(calls.some((call) => call.args.includes('plugin'))).toBe(false);
    expect(said.join('\n')).toContain(`npm could not install @ahpd/server@${VERSION}: EACCES: permission denied`);
    expect(said.join('\n')).toContain('starting the daemon again with the files it was running');
  });

  it('writes what the plugin move said, and still starts the daemon when npm refuses a plugin', async () => {
    // `plugin update` prints each move on its standard output; npm's words and the refusal go to its standard error, the refusal last.
    const { facts, calls, said } = factsOf([false], (call) => (call.args.includes('plugin')
      ? {
          code: 2,
          stdout: 'Updating @ahpd/agent-pi@2.0.0 with npm.\n@ahpd/agent-pi: 1.0.0 to 2.0.0\n',
          stderr: 'npm warn deprecated glob@7.2.3\nnpm error 400 Bad Request - the manifest is refused\nnpm could not update @ahpd/agent-acp\n',
        }
      : { code: 0, stdout: '', stderr: '' }));

    expect(await updateOnce(manifest(), facts)).toBe(0);
    expect(calls.at(-1)?.args).toEqual([ENTRY, 'start', ...LINE]);
    const log = said.join('\n');
    expect(log).toContain('update: @ahpd/agent-pi: 1.0.0 to 2.0.0');
    expect(log).toContain('update: npm error 400 Bad Request - the manifest is refused');
    expect(log).toContain('update: the plugins were not moved: npm could not update @ahpd/agent-acp');
    expect(log).toContain('the daemon is up');
  });

  it('writes each plugin that moved when the move succeeds', async () => {
    const { facts, said } = factsOf([false], (call) => (call.args.includes('plugin')
      ? { code: 0, stdout: '@ahpd/agent-pi: 1.0.0 to 2.0.0\n', stderr: 'added 3 packages\n' }
      : { code: 0, stdout: '', stderr: '' }));

    expect(await updateOnce(manifest(), facts)).toBe(0);
    const log = said.join('\n');
    expect(log).toContain('update: @ahpd/agent-pi: 1.0.0 to 2.0.0');
    expect(log).not.toContain('added 3 packages');
    expect(log).not.toContain('were not moved');
  });

  it('keeps waiting for a daemon still there at the limit, then installs', async () => {
    // The clock moves a second per wait, so the fourth look is past the limit
    // and the daemon goes on the sixth.
    const { facts, calls, said } = factsOf([true, true, true, true, true, false]);

    expect(await updateOnce(manifest({ waitMs: 3_000 }), facts)).toBe(0);
    expect(said.filter((line) => line.includes('is still running after 3 seconds; waiting for it to stop'))).toHaveLength(1);
    expect(calls[0]?.program).toBe('npm');
    expect(calls.at(-1)?.args).toEqual([ENTRY, 'start', ...LINE]);
  });
});
