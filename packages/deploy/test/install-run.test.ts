import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { putService } from '@hallohuman/hightea-services';
import { describe, expect, it } from 'vitest';
import {
  applyInstall,
  customerInstallManifest,
  describeApplyRefusal,
  compareVersions,
  installDeployLayout,
  nodeInstallIo,
  pruneReleaseFolders,
  releasesToPrune,
  renderInstallPlan,
  SERVICES_FILE_SEED,
  configSeed,
  uninstallInstall,
  type InstallIo,
  type InstallPins,
} from '../src/index.js';
import { daemonArchive } from './daemon-archive.js';

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;
const PINS: InstallPins = {
  runtime: { version: '1.3.13', source: 'https://bun.invalid/1.3.13', checksum: sha('a') },
  ahpd: { version: '0.15.0-rc.4', source: 'https://registry.invalid/ahpd-0.15.0-rc.4-linux-x64.tar.gz', checksum: sha('b') },
  hostPlugin: { version: '0.1.0', source: 'https://registry.invalid/host-0.1.0.tgz', checksum: sha('c') },
  supervisor: { version: '1.34.1', source: 'https://releases.invalid/supervisor-1.34.1.gz', checksum: sha('d') },
};

const bytesOf = (source: string) => `bytes:${source}`;
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

/**
 * A real archive for the daemon pin, in the shape the installer accepts: one top-level directory named after the
 * file, with the tree inside. The unpacker is exercised for real on it, not faked.
 */
/** Every pin correct for what the fake fetch returns, so a case fails only where it means to. */
const HONEST: InstallPins = {
  runtime: { ...PINS.runtime, checksum: `sha256:${digest(bytesOf(PINS.runtime.source))}` },
  ahpd: { ...PINS.ahpd, checksum: `sha256:${digest(bytesOf(PINS.ahpd.source))}` },
  hostPlugin: { ...PINS.hostPlugin, checksum: `sha256:${digest(bytesOf(PINS.hostPlugin.source))}` },
  supervisor: { ...PINS.supervisor, checksum: `sha256:${digest(bytesOf(PINS.supervisor.source))}` },
};

const manifestWith = (pins: InstallPins = HONEST) => {
  const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0-rc.4', pins });
  if (!built.ok) throw new Error('expected a manifest: ' + JSON.stringify(built.refusals));
  return built.manifest;
};

interface Fake extends InstallIo {
  /** Makes the next `run` answer a non-zero code, without reassigning a read-only io member. */
  readonly failRun: () => void;
  readonly paths: Set<string>;
  readonly dirs: Set<string>;
  readonly modes: Map<string, number>;
  readonly commands: string[];
  readonly content: Map<string, string>;
}

const fakeIo = (
  existing: readonly string[] = [],
  failing: ReadonlySet<string> = new Set(),
  options: { readonly omitEntry?: boolean } = {},
): Fake => {
  const { omitEntry = false } = options;
  const paths = new Set<string>(existing);
  const dirs = new Set<string>();
  const modes = new Map<string, number>();
  const commands: string[] = [];
  const content = new Map<string, string>();
  let runFails = false;
  const children = (path: string) => [...paths].filter((one) => one !== path && one.startsWith(`${path}/`) && !one.slice(path.length + 1).includes('/'));
  return {
    failRun: () => {
      runFails = true;
    },
    paths,
    dirs,
    modes,
    commands,
    content,
    exists: (path) => paths.has(path),
    isDirectory: (path) => dirs.has(path),
    // Like readdir: names, not paths. The real io and the fake must answer the same shape.
    list: (path) => children(path).map((one) => one.slice(path.length + 1)),
    readFile: (path) => content.get(path) ?? '',
    mkdir: (path) => {
      paths.add(path);
      dirs.add(path);
    },
    writeFile: (path, bytes) => {
      paths.add(path);
      content.set(path, bytes);
    },
    chmod: (path, mode) => modes.set(path, mode),
    fetchTo: async (source, path) => {
      if (failing.has(source)) throw new Error(`${source} is unreachable`);
      paths.add(path);
      content.set(path, bytesOf(source));
    },
    move: (from, to) => {
      paths.delete(from);
      paths.add(to);
      if (dirs.delete(from)) dirs.add(to);
      const bytes = content.get(from);
      content.delete(from);
      if (bytes !== undefined) content.set(to, bytes);
      const mode = modes.get(from);
      modes.delete(from);
      if (mode !== undefined) modes.set(to, mode);
    },
    // The real reader's refusals are tested against real archives; here the tree simply exists after unpacking, with
    // the one entry a release is started from (see RELEASE_ENTRY).
    unpack: (_archive, into) => {
      paths.add(into);
      dirs.add(into);
      if (!omitEntry) {
        paths.add(`${into}/dist/main.js`);
        content.set(`${into}/dist/main.js`, '// the server');
      }
    },
    remove: (path) => {
      paths.delete(path);
      dirs.delete(path);
      content.delete(path);
    },
    listTree: (path) => [...paths].filter((one) => one.startsWith(`${path}/`)),
    removeTree: (path) => {
      for (const one of [...paths]) if (one === path || one.startsWith(`${path}/`)) {
        paths.delete(one);
        dirs.delete(one);
        content.delete(one);
      }
    },
    run: (command) => {
      commands.push(command);
      return runFails ? { code: 1, output: 'launchctl: no such service' } : { code: 0, output: '' };
    },
    hash: (path) => digest(content.get(path) ?? ''),
  };
};

const existsOf = (io: Fake, path: string) => io.paths.has(path);

const recordOf = (io: Fake, manifest: ReturnType<typeof manifestWith>) =>
  JSON.parse(io.content.get(`${manifest.root}/install.json`) ?? '{}') as {
    state?: string;
    manifest?: { version?: string };
  };

describe('apply writes the plan, and refuses what it must (#38280)', () => {
  // @level l3 @consumer a root this install did not create is never adopted, $AHPD_HOME included.
  it('refuses a foreign root and changes nothing', async () => {
    const manifest = manifestWith();
    const io = fakeIo([manifest.root]);
    const result = await applyInstall(manifest, io, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'foreign-root', path: manifest.root });
    expect(result.wrote).toEqual([]);
    expect(describeApplyRefusal(result.refusal!)).toContain('did not create it');
    expect([...io.paths]).toEqual([manifest.root]);
    expect(io.commands).toEqual([]);
  });

  // @level l3 @consumer every directory, four verified downloads made executable, the switch, the boot item, then the record.
  it('creates every entry, marks the downloads executable, switches, enables, and records installed', async () => {
    const manifest = manifestWith();
    const io = fakeIo();
    const switches: { layout: unknown; version: string; reason: string }[] = [];
    const result = await applyInstall(manifest, io, (layout, version, reason) => {
      switches.push({ layout, version, reason });
    });
    expect(result.ok).toBe(true);
    expect(recordOf(io, manifest).state).toBe('installed');
    const plan = renderInstallPlan(manifest).join('\n');
    for (const path of result.wrote) expect(plan).toContain(path);
    expect(switches).toEqual([{ layout: installDeployLayout(manifest), version: '0.15.0-rc.4', reason: 'customer host install' }]);
    expect(io.commands).toEqual([manifest.bootItem.enable]);
    // What runs is what was checked: the three single-file artifacts are 0755 at their final path, and the daemon is
    // a tree unpacked from its archive rather than one executable.
    for (const name of ['runtime', 'hostPlugin', 'supervisor'] as const) {
      const entry = manifest.entries.find((one) => one.from === `download:${name}`)!;
      expect(io.modes.get(entry.path)).toBe(0o755);
    }
    const archive = manifest.entries.find((one) => one.kind === 'archive')!;
    expect(io.dirs.has(archive.path)).toBe(true);
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
  });

  // @level l3 @consumer the boot item on disk runs `current`'s supervisor against `current`'s yaml and escapes the
  // root for XML; the trial's flag set is the one the #38120 scorecard ran under (@dev/6 df76c0d1).
  it('writes a plist that escapes the root and a unit with WantedBy alone', async () => {
    const macBuilt = customerInstallManifest({ platform: 'darwin', arch: 'arm64', home: '/home/customer', version: '0.15.0-rc.4', pins: HONEST });
    if (!macBuilt.ok) throw new Error('expected a manifest');
    const mac = macBuilt.manifest;
    const macIo = fakeIo();
    await applyInstall(mac, macIo, () => undefined);
    const plist = macIo.content.get(`${mac.root}/boot/launchd-agent`) ?? '';
    expect(plist).toContain('dev.hallohuman.ahpd');
    const macCurrent = `${mac.root}/state/deploy/ahpd/current`;
    expect(plist).toContain(`<string>${macCurrent}/supervisor</string>`);
    expect(plist).toContain('<string>up</string>');
    expect(plist).toContain(`<string>${macCurrent}/process-compose.yaml</string>`);
    expect(plist).toContain('<string>-t=false</string>');
    expect(plist).toContain('<string>-U</string>');
    expect(plist).toContain(`<string>${mac.root}/state/pc.sock</string>`);
    expect(plist).toContain(`<string>${mac.root}/state/process-compose.log</string>`);

    const built = customerInstallManifest({ platform: 'darwin', arch: 'arm64', home: '/home/c&d"x', version: '0.15.0-rc.4', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    const io = fakeIo();
    await applyInstall(built.manifest, io, () => undefined);
    const escaped = io.content.get(`${built.manifest.root}/boot/launchd-agent`) ?? '';
    expect(escaped).toContain('&amp;');
    expect(escaped).not.toContain('c&d');

    const linux = manifestWith();
    const linuxIo = fakeIo();
    await applyInstall(linux, linuxIo, () => undefined);
    const unit = linuxIo.content.get(`${linux.root}/boot/systemd-user-unit`) ?? '';
    const linuxCurrent = `${linux.root}/state/deploy/ahpd/current`;
    expect(unit).toContain(
      `ExecStart=${linuxCurrent}/supervisor up -f ${linuxCurrent}/process-compose.yaml -f ${linux.root}/state/services.yaml -t=false -U -u ${linux.root}/state/pc.sock -L ${linux.root}/state/process-compose.log`,
    );
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).not.toContain('After=default.target');

    // systemd joins ExecStart's words with spaces, so a root with a space is quoted word by word and still splits right.
    const spaced = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer name', version: '0.15.0-rc.4', pins: HONEST });
    if (!spaced.ok) throw new Error('expected a manifest');
    const spacedIo = fakeIo();
    await applyInstall(spaced.manifest, spacedIo, () => undefined);
    const spacedUnit = spacedIo.content.get(`${spaced.manifest.root}/boot/systemd-user-unit`) ?? '';
    const spacedCurrent = `${spaced.manifest.root}/state/deploy/ahpd/current`;
    expect(spacedUnit).toContain(
      `ExecStart="${spacedCurrent}/supervisor" up -f "${spacedCurrent}/process-compose.yaml" -f "${spaced.manifest.root}/state/services.yaml" -t=false -U -u "${spaced.manifest.root}/state/pc.sock" -L "${spaced.manifest.root}/state/process-compose.log"`,
    );
  });

  // @level l3 @consumer a download that does not match its pin stops the install by name, before it is placed.
  it('refuses a download whose bytes do not match the pinned checksum', async () => {
    const manifest = manifestWith({ ...HONEST, ahpd: { ...HONEST.ahpd, checksum: sha('f') } });
    const io = fakeIo();
    const switches: string[] = [];
    const result = await applyInstall(manifest, io, (_layout, version) => {
      switches.push(version);
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'checksum-mismatch', download: 'ahpd' });
    expect(describeApplyRefusal(result.refusal!)).toContain('does not match its pinned checksum');
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
    expect(switches).toEqual([]);
    expect(io.commands).toEqual([]);
    // The record stays `installing`, so a retry is not locked out of its own folder.
    expect(recordOf(io, manifest).state).toBe('installing');
  });

  // @level l3 @consumer an interrupted install resumes instead of refusing its own folder as foreign.
  it('resumes an install that stopped at the second download', async () => {
    const manifest = manifestWith();
    const stuck = fakeIo([], new Set([PINS.ahpd.source]));
    const first = await applyInstall(manifest, stuck, () => undefined);
    expect(first.ok).toBe(false);
    expect(first.refusal).toMatchObject({ kind: 'step-failed', step: 'download' });
    expect(recordOf(stuck, manifest).state).toBe('installing');
    expect([...stuck.paths]).toContain(`${manifest.root}/install.json`);

    const retry = fakeIo([...stuck.paths]);
    for (const [path, bytes] of stuck.content) retry.content.set(path, bytes);
    const second = await applyInstall(manifest, retry, () => undefined);
    expect(second.ok).toBe(true);
    expect(recordOf(retry, manifest).state).toBe('installed');
  });

  // @level l3 @consumer a throwing io call is a refusal that names the step and path, never a crash, and stages nothing.
  it('turns a throwing fetch into a named refusal and leaves no staged bytes', async () => {
    const manifest = manifestWith();
    const io = fakeIo([], new Set([PINS.runtime.source]));
    const result = await applyInstall(manifest, io, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'step-failed', step: 'download', path: PINS.runtime.source });
    expect(describeApplyRefusal(result.refusal!)).toContain('is unreachable');
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
  });

  // @level l3 @consumer a null checksum at apply time is refused, never defaulted to sha256.
  it('refuses a pin with no checksum at apply time', async () => {
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0-rc.4', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = { ...built.manifest, pins: { ...built.manifest.pins, ahpd: { ...built.manifest.pins.ahpd, checksum: null } } };
    const io = fakeIo();
    const result = await applyInstall(manifest, io, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'missing-checksum', download: 'ahpd' });
  });
});

describe('a version switch places, activates and prunes by one shared rule (#38280)', () => {
  // @level l3 @consumer the rule lives once in @ahpd/deploy; a git deploy orders by commit time, an install by version.
  it('keeps current plus the newest keep-1, and orders versions numerically', () => {
    // The caller supplies the newest-first order; the rule decides what goes.
    expect(releasesToPrune(['0.11.0', '0.10.0', '0.9.0'], '0.11.0', 3)).toEqual([]);
    expect(releasesToPrune(['0.12.0', '0.11.0', '0.10.0', '0.9.0'], '0.12.0', 3)).toEqual(['0.9.0']);
    // `current` is kept even when it is older than everything else: it is what is running, plus the newest other.
    expect(releasesToPrune(['0.12.0', '0.11.0', '0.10.0'], '0.10.0', 2)).toEqual(['0.11.0']);
    expect(releasesToPrune(['1.0.0', '1.0.0-rc.1'], '1.0.0', 1)).toEqual(['1.0.0-rc.1']);
    // Pre-release parts compare segment by segment, numerically: rc.10 is above rc.9.
    expect(releasesToPrune(['1.0.0-rc.10', '1.0.0-rc.9', '1.0.0-rc.8'], '1.0.0-rc.10', 1)).toEqual([
      '1.0.0-rc.9',
      '1.0.0-rc.8',
    ]);
    expect(['0.9.0', '0.10.0', '1.0.0-rc.1', '1.0.0'].sort(compareVersions)).toEqual([
      '1.0.0',
      '1.0.0-rc.1',
      '0.10.0',
      '0.9.0',
    ]);
  });

  // @level l3 @consumer a successful switch keeps its way back: the release it left survives the prune that follows.
  it('keeps the release the last switch left, so one switch back is always possible', () => {
    // keep 2 is current plus exactly one way back: the 0.10.0 that ran is kept and the newest other one goes without it.
    expect(releasesToPrune(['0.12.0', '0.11.0', '0.10.0'], '0.12.0', 2, '0.10.0')).toEqual(['0.11.0']);
    expect(releasesToPrune(['0.12.0', '0.11.0', '0.10.0'], '0.12.0', 2)).toEqual(['0.10.0']);
    // The folder that actually ran outranks a newer one, because it is the one a rollback returns to.
    expect(releasesToPrune(['0.13.0', '0.12.0', '0.11.0', '0.10.0'], '0.11.0', 2, '0.10.0')).toEqual([
      '0.13.0',
      '0.12.0',
    ]);
    // keep 1 has no room for a second folder, and a target that is already gone is not invented.
    expect(releasesToPrune(['0.12.0', '0.11.0'], '0.12.0', 1, '0.11.0')).toEqual(['0.11.0']);
    expect(releasesToPrune(['0.12.0', '0.11.0'], '0.12.0', 3, '9.9.9')).toEqual([]);
  });

  // @level l3 @consumer switching versions moves current, restarts the boot item and says which folders it deleted.
  it('installs a second version, restarts the boot item, and prunes the oldest past keep', async () => {
    const io = fakeIo();
    const switched: string[] = [];
    const switchTo = (_layout: unknown, version: string) => {
      switched.push(version);
    };
    for (const version of ['0.13.0', '0.14.0', '0.15.0', '0.16.0']) {
      const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version, pins: HONEST });
      if (!built.ok) throw new Error('expected a manifest');
      const result = await applyInstall(built.manifest, io, switchTo);
      expect(result.ok).toBe(true);
      expect(result.pruned).toEqual(version === '0.16.0' ? ['0.13.0'] : []);
      expect(existsOf(io, `${built.manifest.root}/state/deploy/ahpd/releases/${version}`)).toBe(true);
    }
    expect(switched).toEqual(['0.13.0', '0.14.0', '0.15.0', '0.16.0']);
    // Only the first install starts the boot item; each switch stops it first and starts it again.
    const enables = io.commands.filter((command) => command.includes('enable'));
    const disables = io.commands.filter((command) => command.includes('disable'));
    expect(enables).toHaveLength(4);
    expect(disables).toHaveLength(3);
    expect(existsOf(io, '/home/customer/.ahpd/state/deploy/ahpd/releases/0.13.0')).toBe(false);
  });

  // @level l3 @consumer a folder that is not a version is never pruned, and it is named rather than guessed at.
  it('keeps a stray folder in releases and says why', () => {
    const releases = '/r/state/deploy/ahpd/releases';
    const io = fakeIo([releases, `${releases}/junk`, `${releases}/0.15.0`, `${releases}/0.16.0`]);
    for (const path of [releases, `${releases}/junk`, `${releases}/0.15.0`, `${releases}/0.16.0`]) io.dirs.add(path);
    const out = pruneReleaseFolders(io, { stateDir: '/r/state', service: 'ahpd' }, '0.16.0', 1);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.kept).toEqual([{ name: 'junk', why: 'not a version' }]);
    expect(out.removed).toEqual(['0.15.0']);
    expect(io.paths.has(`${releases}/junk`)).toBe(true);
  });

  // @level l3 @consumer pruning a customer host keeps the release it switched from when keep leaves room for it.
  it('keeps the release a version switch left when pruning', () => {
    const releases = '/r/state/deploy/ahpd/releases';
    const names = ['0.13.0', '0.14.0', '0.15.0'];
    const io = fakeIo([releases, ...names.map((version) => `${releases}/${version}`)]);
    for (const name of names) io.dirs.add(`${releases}/${name}`);
    const out = pruneReleaseFolders(io, { stateDir: '/r/state', service: 'ahpd' }, '0.15.0', 2, '0.14.0');
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.removed).toEqual(['0.13.0']);
  });

  // @level l3 @consumer a start that fails switches back: current on the old release, the old service running, and
  // nothing pruned, so a bad switch never leaves a dead host pointing at a release nobody started.
  it('switches back when the restarted boot item will not start, and prunes nothing', async () => {
    const io = fakeIo();
    const switched: string[] = [];
    const switchTo = (_layout: unknown, version: string) => {
      switched.push(version);
    };
    const first = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.13.0', pins: HONEST });
    if (!first.ok) throw new Error('expected a manifest');
    expect((await applyInstall(first.manifest, io, switchTo)).ok).toBe(true);
    // Four releases first, so a prune would have something to remove if it ran at the wrong moment.
    for (const version of ['0.14.0', '0.15.0']) {
      const next = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version, pins: HONEST });
      if (!next.ok) throw new Error('expected a manifest');
      expect((await applyInstall(next.manifest, io, switchTo)).ok).toBe(true);
    }
    io.failRun();
    const failing = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.16.0', pins: HONEST });
    if (!failing.ok) throw new Error('expected a manifest');
    const result = await applyInstall(failing.manifest, io, switchTo);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'step-failed', step: 'enable boot item' });
    const text = describeApplyRefusal(result.refusal!);
    expect(text).toContain('launchctl: no such service');
    expect(text).toContain('switched back to 0.15.0');
    // The old release's own start failed too, so the refusal says so in its own clause: "down" never reads as "back".
    expect(text).toContain('switch-back to 0.15.0 also failed: launchctl: no such service');
    // The last two switches are: onto 0.16.0, then back to the release that was running.
    expect(switched.slice(-2)).toEqual(['0.16.0', '0.15.0']);
    expect(result.pruned).toEqual([]);
    expect(recordOf(io, failing.manifest).manifest?.version).toBe('0.15.0');
    expect(existsOf(io, '/home/customer/.ahpd/state/deploy/ahpd/releases/0.13.0')).toBe(true);
  });

  // @level l3 @consumer a switch back that works says nothing about failing, and the record follows the old release.
  it('switches back cleanly when only the new release fails to start', async () => {
    const io = fakeIo();
    const switched: string[] = [];
    const switchTo = (_layout: unknown, version: string) => {
      switched.push(version);
    };
    const first = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0', pins: HONEST });
    if (!first.ok) throw new Error('expected a manifest');
    expect((await applyInstall(first.manifest, io, switchTo)).ok).toBe(true);
    // Exactly one enable fails - the new release's - and the switch back's own start succeeds.
    let enables = 0;
    const oneBadStart = {
      ...io,
      run: (command: string) => {
        if (command.includes('enable')) {
          enables += 1;
          if (enables === 1) return { code: 1, output: 'launchctl: bootstrap failed' };
        }
        return io.run(command);
      },
    };
    const failing = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.16.0', pins: HONEST });
    if (!failing.ok) throw new Error('expected a manifest');
    const result = await applyInstall(failing.manifest, oneBadStart, switchTo);
    expect(result.ok).toBe(false);
    const text = describeApplyRefusal(result.refusal!);
    expect(text).toContain('switched back to 0.15.0');
    expect(text).not.toContain('also failed');
    expect(recordOf(io, failing.manifest).manifest?.version).toBe('0.15.0');
    expect(switched.slice(-2)).toEqual(['0.16.0', '0.15.0']);
  });

  // @level l3 @consumer a prune that fails after a started release is a warning on a good install, not a failure.
  it('records the release as installed before pruning, and reports a prune failure without failing the install', async () => {
    const io = fakeIo();
    const switched: string[] = [];
    const switchTo = (_layout: unknown, version: string) => {
      switched.push(version);
    };
    const first = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.13.0', pins: HONEST });
    if (!first.ok) throw new Error('expected a manifest');
    expect((await applyInstall(first.manifest, io, switchTo)).ok).toBe(true);
    const releases = '/home/customer/.ahpd/state/deploy/ahpd/releases';
    const cannotList = {
      ...io,
      list: (path: string) => {
        if (path === releases) throw new Error('EACCES: permission denied');
        return io.list(path);
      },
    };
    const next = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.14.0', pins: HONEST });
    if (!next.ok) throw new Error('expected a manifest');
    const result = await applyInstall(next.manifest, cannotList, switchTo);
    expect(result.ok).toBe(true);
    expect(result.refusal).toBeUndefined();
    expect(result.pruneFailed).toEqual({ path: releases, output: 'EACCES: permission denied' });
    // The record says installed, not installing: the release that is running is recorded before the tidy-up.
    expect(recordOf(io, next.manifest).state).toBe('installed');
    expect(recordOf(io, next.manifest).manifest?.version).toBe('0.14.0');
    expect(existsOf(io, `${releases}/0.13.0`)).toBe(true);
  });

  // @level l3 @consumer one folder that will not delete stops the prune and is named, with what was already gone.
  it('names the release a prune could not remove, and reports the ones it did', async () => {
    const io = fakeIo();
    const switchTo = () => undefined;
    // Seeded with a list() that cannot see the release folders, so nothing is pruned on the way in and the final
    // apply has three folders to remove.
    const blind = {
      ...io,
      list: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    for (const version of ['0.13.0', '0.14.0', '0.15.0', '0.16.0', '0.17.0']) {
      const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version, pins: HONEST });
      if (!built.ok) throw new Error('expected a manifest');
      expect((await applyInstall(built.manifest, blind, switchTo)).ok).toBe(true);
    }
    const releases = '/home/customer/.ahpd/state/deploy/ahpd/releases';
    const busy = {
      ...io,
      removeTree: (path: string) => {
        if (path === `${releases}/0.14.0`) throw new Error('EBUSY: resource busy');
        io.removeTree(path);
      },
    };
    const next = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.18.0', pins: HONEST });
    if (!next.ok) throw new Error('expected a manifest');
    const result = await applyInstall(next.manifest, busy, switchTo);
    // A prune that hit a locked folder is a warning on a good install, never an exception or a failed install.
    expect(result.ok).toBe(true);
    expect(result.refusal).toBeUndefined();
    expect(result.pruneFailed).toEqual({ path: `${releases}/0.14.0`, output: 'EBUSY: resource busy' });
    expect(result.pruned).toEqual(['0.15.0']);
    expect(recordOf(io, next.manifest).state).toBe('installed');
    expect(existsOf(io, `${releases}/0.15.0`)).toBe(false);
    expect(existsOf(io, `${releases}/0.14.0`)).toBe(true);
    expect(existsOf(io, `${releases}/0.13.0`)).toBe(true);
  });

  // @level l3 @consumer a switch that throws is refused by name, before the boot item is touched.
  it('refuses by name when moving current throws', async () => {
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.13.0', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    const result = await applyInstall(built.manifest, fakeIo(), () => {
      throw new Error('EXDEV: cross-device link not permitted');
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'step-failed', step: 'switch release' });
    expect(describeApplyRefusal(result.refusal!)).toContain('EXDEV');
  });

  // @level l3 @consumer a record that will not parse is refused, never read as a fresh install.
  it('refuses an unreadable install record and changes nothing', async () => {
    const manifest = manifestWith();
    const io = fakeIo([manifest.root, `${manifest.root}/install.json`]);
    io.content.set(`${manifest.root}/install.json`, '{ not json');
    const result = await applyInstall(manifest, io, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'step-failed', step: 'read install record' });
    expect(describeApplyRefusal(result.refusal!)).toContain('is unreadable');
    expect(io.content.get(`${manifest.root}/install.json`)).toBe('{ not json');
  });
});

describe('uninstall removes what install wrote, and keeps what it did not (#38280)', () => {
  // @level l3 @consumer the boot item is disabled first, every written entry goes, and an empty folder goes with them.
  it('disables the boot item, then removes the entries in reverse and lists them', () => {
    const manifest = manifestWith();
    const io = fakeIo(manifest.entries.map((entry) => entry.path));
    for (const entry of manifest.entries) if (entry.kind === 'dir') io.dirs.add(entry.path);
    io.content.set(`${manifest.root}/state/services.yaml`, SERVICES_FILE_SEED);
    io.content.set(`${manifest.root}/state/config.json`, configSeed(manifest));
    const result = uninstallInstall(manifest, io);
    expect(result.ok).toBe(true);
    expect(io.commands).toEqual([manifest.bootItem.disable]);
    expect(result.removed).toEqual([...manifest.entries.map((entry) => entry.path)].reverse());
    expect(result.kept).toEqual([]);
    expect([...io.paths]).toEqual([]);
  });

  // @level l3 @consumer the daemon's sessions and logs are not ours to delete: kept, counted, and named.
  it('keeps a folder the daemon filled, says how much is in it, and only purge deletes it', () => {
    const manifest = manifestWith();
    const state = `${manifest.root}/state`;
    const io = fakeIo([...manifest.entries.map((entry) => entry.path), `${state}/sessions.json`, `${state}/ahpd.out.log`]);
    for (const entry of manifest.entries) if (entry.kind === 'dir') io.dirs.add(entry.path);
    io.content.set(`${state}/services.yaml`, SERVICES_FILE_SEED);
    io.content.set(`${state}/config.json`, configSeed(manifest));
    const keptResult = uninstallInstall(manifest, io);
    expect(keptResult.ok).toBe(true);
    expect(keptResult.kept).toEqual([
      `kept ${state}: 2 entries not written by this install; remove by hand or run uninstall --purge`,
      `kept ${manifest.root}: 1 entry not written by this install; remove by hand or run uninstall --purge`,
    ]);
    expect([...io.paths]).toContain(`${state}/sessions.json`);

    const purgeIo = fakeIo([...manifest.entries.map((entry) => entry.path), `${state}/sessions.json`]);
    for (const entry of manifest.entries) if (entry.kind === 'dir') purgeIo.dirs.add(entry.path);
    const confirmed: (readonly string[])[] = [];
    const purged = uninstallInstall(manifest, purgeIo, {
      purge: true,
      confirmPurge: (inside) => {
        confirmed.push(inside);
        return true;
      },
    });
    expect(purged.ok).toBe(true);
    expect(purged.removed).toContain(state);
    // The list reaches the caller before anything goes, so --purge can print exactly what it deletes.
    expect(confirmed.flat()).toContain(`${state}/sessions.json`);
    expect([...purgeIo.paths]).toEqual([]);
  });

  // @level l3 @consumer the real filesystem: the fake io cannot show that a directory needs its own removal call.
  it('runs on a real tmpdir: keeps the daemon state, removes the rest, and purges only on request', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-uninstall-')));
    const archive = daemonArchive(HONEST.ahpd.source);
    const pins: InstallPins = { ...HONEST, ahpd: { ...HONEST.ahpd, checksum: `sha256:${createHash('sha256').update(archive).digest('hex')}` } };
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home, version: '0.15.0-rc.4', pins });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = built.manifest;
    const real = nodeInstallIo();
    const io: InstallIo = {
      ...real,
      fetchTo: async (source, path) => writeFileSync(path, source === pins.ahpd.source ? archive : bytesOf(source)),
      run: (command) => {
        void command;
        return { code: 0, output: '' };
      },
    };
    expect((await applyInstall(manifest, io, () => undefined)).ok).toBe(true);
    // The daemon writes into its state dir, as it will on a real host.
    mkdirSync(`${manifest.root}/state`, { recursive: true });
    writeFileSync(`${manifest.root}/state/sessions.json`, '[]');
    // apply's symlink step does not write `current` on its own; place the switch's link here, for real, so uninstall
    // meets the one entry that is a link to a directory and not a file or a folder.
    const current = manifest.entries.find((entry) => entry.kind === 'symlink');
    if (current === undefined) throw new Error('expected a current symlink entry');
    symlinkSync('releases/0.15.0-rc.4', current.path);

    const keptRun = uninstallInstall(manifest, io);
    expect(keptRun.ok).toBe(true);
    expect(keptRun.kept.join('\n')).toContain(`kept ${manifest.root}/state: 1 entry`);
    expect(existsSync(`${manifest.root}/state/sessions.json`)).toBe(true);
    expect(existsSync(`${manifest.root}/install.json`)).toBe(false);
    expect(existsSync(`${manifest.root}/boot`)).toBe(false);
    // The link goes as a link: following it would call rmdir on it and fail with ENOTDIR.
    expect(() => lstatSync(current.path)).toThrow(/ENOENT/u);

    let printed: readonly string[] = [];
    const purged = uninstallInstall(manifest, io, {
      purge: true,
      confirmPurge: (inside) => {
        printed = inside;
        return true;
      },
    });
    expect(purged.ok).toBe(true);
    expect(printed).toContain('sessions.json');
    expect(existsSync(`${manifest.root}/state`)).toBe(false);
    // Already-gone paths read as already gone, never as a failure.
    expect(keptRun.removed.every((path) => path.includes('already gone') || existsSync(path) === false)).toBe(true);
  });

  // @level l3 @consumer an interrupted install leaves its staging tree behind; the next run clears it instead of
  // merging it into the release that `current` will point at.
  it('clears a leftover staging tree on a real tmpdir, so a stuck install recovers', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-staging-')));
    const archive = daemonArchive(HONEST.ahpd.source);
    const pins: InstallPins = { ...HONEST, ahpd: { ...HONEST.ahpd, checksum: `sha256:${createHash('sha256').update(archive).digest('hex')}` } };
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home, version: '0.15.0-rc.4', pins });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = built.manifest;
    const real = nodeInstallIo();
    const io: InstallIo = {
      ...real,
      fetchTo: async (source, path) => writeFileSync(path, source === pins.ahpd.source ? archive : bytesOf(source)),
      run: (command) => {
        void command;
        return { code: 0, output: '' };
      },
    };
    // The state an interrupted run leaves: the root marks itself installing, and a staging tree is half written.
    mkdirSync(manifest.root, { recursive: true });
    writeFileSync(join(manifest.root, 'install.json'), JSON.stringify({ state: 'installing', manifest }));
    const staging = `${manifest.root}/state/deploy/ahpd/releases/0.15.0-rc.4.staging`;
    mkdirSync(join(staging, 'left', 'from-an-earlier-run'), { recursive: true });
    writeFileSync(join(staging, 'left', 'from-an-earlier-run', 'stale.js'), 'stale\n');

    expect((await applyInstall(manifest, io, () => undefined)).ok).toBe(true);
    const release = `${manifest.root}/state/deploy/ahpd/releases/0.15.0-rc.4`;
    expect(existsSync(join(release, 'left', 'from-an-earlier-run', 'stale.js'))).toBe(false);
    expect(existsSync(staging)).toBe(false);
  });

  // @level l3 @consumer a boot item that will not stop is reported with its own words and nothing is removed after it.
  it('stops at a boot item that will not disable', () => {
    const manifest = manifestWith();
    const io = fakeIo(manifest.entries.map((entry) => entry.path));
    io.failRun();
    const result = uninstallInstall(manifest, io);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'step-failed', step: 'disable boot item' });
    expect(result.removed).toEqual([]);
    expect([...io.paths]).toHaveLength(manifest.entries.length);
  });

  // @level l2 @consumer uninstall runs twice: a boot item that is already off is a fact, not a failure.
  it('finishes when the boot item answers that it is already off', () => {
    const manifest = manifestWith();
    const io = fakeIo(manifest.entries.map((entry) => entry.path));
    const answers = [
      { code: 3, output: 'Boot-out failed: 3: No such process' },
      { code: 3, output: 'Could not find service "dev.hallohuman.ahpd" in domain for user gui: 501' },
    ];
    for (const answer of answers) {
      const run = { ...io, run: () => answer };
      const result = uninstallInstall(manifest, run);
      expect(result.ok).toBe(true);
      expect(result.refusal).toBeUndefined();
      expect(result.removed.length).toBeGreaterThan(0);
    }
  });
});

/**
 * #38277 S2: the boot item runs process-compose against two project files, and the install writes both.
 * @failure the boot item names a project file no step writes; an upgrade rewrites or drops the machine's services; a
 *   switch back runs one release's tree with another's project file; uninstall deletes services a person added
 * @level l2 (applyInstall and uninstallInstall over the fake io; the real tmpdir run above covers the node io)
 */
describe('the install writes the project files the boot item runs (#38277 S2)', () => {
  const releaseOf = (manifest: ReturnType<typeof manifestWith>, version = manifest.version) => `${manifest.root}/state/deploy/ahpd/releases/${version}`;

  it('writes the release file inside the release folder, naming that release and nothing else, before the switch', async () => {
    const manifest = manifestWith();
    const io = fakeIo();
    const switched: string[] = [];
    const result = await applyInstall(manifest, io, ((_layout: unknown, version: string) => {
      // The project file is already in the release folder when current moves onto it.
      expect(io.paths.has(`${releaseOf(manifest)}/process-compose.yaml`)).toBe(true);
      switched.push(version);
    }) as never);
    expect(result.ok).toBe(true);
    const release = releaseOf(manifest);
    const compose = io.content.get(`${release}/process-compose.yaml`) ?? '';
    expect(compose).toContain(`command: "'${release}/runtime' '${release}/dist/main.js' '--config-file' '${manifest.root}/state/config.json'"`);
    expect(compose).toContain('- "PATH=/usr/local/bin:/usr/bin:/bin"');
    expect(compose).not.toContain('/current/');
    expect(result.wrote.indexOf(`${release}/process-compose.yaml`)).toBeGreaterThan(result.wrote.indexOf(release));
    expect(switched).toEqual([manifest.version]);
  });

  // @level l2 @consumer a release that unpacked but has no server entry is refused by name, never switched to.
  it('refuses an archive without the entry the project file starts, and places nothing', async () => {
    const manifest = manifestWith();
    const io = fakeIo([], new Set(), { omitEntry: true });
    const switched: string[] = [];
    const result = await applyInstall(manifest, io, ((_layout: unknown, version: string) => {
      switched.push(version);
    }) as never);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ step: 'unpack archive', path: `${releaseOf(manifest)}` });
    expect(JSON.stringify(result.refusal)).toContain('dist/main.js');
    expect(switched).toEqual([]);
    expect(io.paths.has(releaseOf(manifest))).toBe(false);
    expect(io.paths.has(`${releaseOf(manifest)}.staging`)).toBe(false);
  });

  it('seeds the services file once and an upgrade keeps a changed one byte for byte', async () => {
    const first = manifestWith();
    const io = fakeIo();
    expect((await applyInstall(first, io, () => undefined)).ok).toBe(true);
    const services = `${first.root}/state/services.yaml`;
    expect(io.content.get(services)).toBe(SERVICES_FILE_SEED);
    const edited = 'processes:\n  web:\n    command: "\'/srv/web\' --port 8080"\n';
    io.content.set(services, edited);
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0-rc.5', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    expect((await applyInstall(built.manifest, io, () => undefined)).ok).toBe(true);
    expect(io.content.get(services)).toBe(edited);
    // Each release keeps its own project file, so switching back to 0.15.0-rc.4 runs the file it was installed with.
    expect(io.content.get(`${releaseOf(first)}/process-compose.yaml`)).toContain(`${releaseOf(first)}/runtime`);
    expect(io.content.get(`${releaseOf(built.manifest)}/process-compose.yaml`)).toContain(`${releaseOf(built.manifest)}/runtime`);
  });

  it('uninstall keeps a services file a person changed, names it, and only purge deletes it', () => {
    const manifest = manifestWith();
    const services = `${manifest.root}/state/services.yaml`;
    const io = fakeIo(manifest.entries.map((entry) => entry.path));
    for (const entry of manifest.entries) if (entry.kind === 'dir') io.dirs.add(entry.path);
    io.content.set(services, 'processes:\n  web:\n    command: "/srv/web"\n');
    io.content.set(`${manifest.root}/state/config.json`, configSeed(manifest));
    const kept = uninstallInstall(manifest, io);
    expect(kept.ok).toBe(true);
    expect(kept.kept[0]).toBe(`kept ${services}: this machine's services; remove by hand or run uninstall --purge`);
    expect(io.paths.has(services)).toBe(true);
    const purged = uninstallInstall(manifest, io, { purge: true });
    expect(purged.ok).toBe(true);
    expect(io.paths.has(services)).toBe(false);
  });

  // @cto e46dd009 row 1: a fresh install boots with both files - the boot item names the pair, and both exist.
  it('a fresh install boots with both files: the unit names the pair and apply wrote each one', async () => {
    const manifest = manifestWith();
    const io = fakeIo();
    expect((await applyInstall(manifest, io, () => undefined)).ok).toBe(true);
    const unit = io.content.get(`${manifest.root}/boot/systemd-user-unit`) ?? '';
    const current = `${manifest.root}/state/deploy/ahpd/current`;
    expect(unit).toContain(`-f ${current}/process-compose.yaml -f ${manifest.root}/state/services.yaml `);
    expect(io.paths.has(`${releaseOf(manifest)}/process-compose.yaml`)).toBe(true);
    expect(io.paths.has(`${manifest.root}/state/services.yaml`)).toBe(true);
  });

  // @cto e46dd009 row 2: the failed-start switch back runs the old release's own file, and the machine file is untouched.
  it('a switch back after a failed start leaves the old release file as it was and keeps the machine file', async () => {
    const io = fakeIo();
    const first = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0', pins: HONEST });
    if (!first.ok) throw new Error('expected a manifest');
    expect((await applyInstall(first.manifest, io, () => undefined)).ok).toBe(true);
    const oldFile = `${releaseOf(first.manifest)}/process-compose.yaml`;
    const oldText = io.content.get(oldFile);
    const services = `${first.manifest.root}/state/services.yaml`;
    const edited = 'processes:\n  web:\n    command: "/srv/web"\n';
    io.content.set(services, edited);
    io.failRun();
    const failing = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.16.0', pins: HONEST });
    if (!failing.ok) throw new Error('expected a manifest');
    const switched: string[] = [];
    const result = await applyInstall(failing.manifest, io, ((_layout: unknown, version: string) => { switched.push(version); }) as never);
    expect(result.ok).toBe(false);
    expect(switched).toEqual(['0.16.0', '0.15.0']);
    expect(io.content.get(oldFile)).toBe(oldText);
    expect(oldText).toContain(`${releaseOf(first.manifest)}/runtime`);
    expect(io.content.get(services)).toBe(edited);
  });

  // @cto e46dd009 row 3: on a real install, the services plugin refuses a machine entry that would shadow ahpd, by name.
  it('the services plugin refuses a machine entry named after the release file\'s ahpd, naming that file', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-shadow-')));
    const archive = daemonArchive(HONEST.ahpd.source);
    const pins: InstallPins = { ...HONEST, ahpd: { ...HONEST.ahpd, checksum: `sha256:${createHash('sha256').update(archive).digest('hex')}` } };
    const built = customerInstallManifest({ platform: 'linux', arch: 'x64', home, version: '0.15.0-rc.4', pins });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = built.manifest;
    const io: InstallIo = {
      ...nodeInstallIo(),
      fetchTo: async (source, path) => writeFileSync(path, source === pins.ahpd.source ? archive : bytesOf(source)),
      run: () => ({ code: 0, output: '' }),
    };
    expect((await applyInstall(manifest, io, () => undefined)).ok).toBe(true);
    const release = `${releaseOf(manifest)}/process-compose.yaml`;
    const services = `${manifest.root}/state/services.yaml`;
    const machine = { name: 'test-machine', files: [release, services], configDir: `${manifest.root}/state`, changeLog: `${manifest.root}/state/changes.jsonl`, pc: {} as never };
    const before = readFileSync(services, 'utf8');
    const answer = await putService(machine, { principal: 'local:test', remote: false }, { service: { name: 'ahpd', command: '/bin/true' }, ifVersion: createHash('sha256').update(before).digest('hex') });
    expect(answer).toMatchObject({ ok: false, code: 'READ_ONLY' });
    if (!answer.ok) expect(answer.message).toContain(`it is defined in ${release}`);
    expect(readFileSync(services, 'utf8')).toBe(before);
  });

  // @cto 65231d93 row: ahpd's own config writes survive a switch, and a switch back.
  it('an agent pair ahpd wrote into its configuration survives an upgrade and a failed-start switch back', async () => {
    const io = fakeIo();
    const first = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.15.0', pins: HONEST });
    if (!first.ok) throw new Error('expected a manifest');
    expect((await applyInstall(first.manifest, io, () => undefined)).ok).toBe(true);
    const config = `${first.manifest.root}/state/config.json`;
    expect(JSON.parse(io.content.get(config) ?? '{}')).toEqual({ plugins: [{ source: `${first.manifest.root}/state/deploy/ahpd/current/host-plugin` }] });
    // What ahpd writes at run time: an agents pair beside the plug-in entry.
    const written = `${JSON.stringify({ plugins: [{ source: `${first.manifest.root}/state/deploy/ahpd/current/host-plugin` }], agents: [{ id: 'codex', account: 'a' }] }, null, 2)}\n`;
    io.content.set(config, written);
    const second = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.16.0', pins: HONEST });
    if (!second.ok) throw new Error('expected a manifest');
    expect((await applyInstall(second.manifest, io, () => undefined)).ok).toBe(true);
    expect(io.content.get(config)).toBe(written);
    io.failRun();
    const third = customerInstallManifest({ platform: 'linux', arch: 'x64', home: '/home/customer', version: '0.17.0', pins: HONEST });
    if (!third.ok) throw new Error('expected a manifest');
    const switched: string[] = [];
    expect((await applyInstall(third.manifest, io, ((_l: unknown, version: string) => { switched.push(version); }) as never)).ok).toBe(false);
    expect(switched).toEqual(['0.17.0', '0.16.0']);
    expect(io.content.get(config)).toBe(written);
  });
});
