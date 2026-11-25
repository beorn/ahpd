import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyInstall,
  customerInstallManifest,
  describeApplyRefusal,
  installDeployLayout,
  nodeInstallIo,
  renderInstallPlan,
  uninstallInstall,
  type InstallIo,
  type InstallPins,
} from '../src/index.js';

const sha = (letter: string) => `sha256:${letter.repeat(64)}`;
const PINS: InstallPins = {
  runtime: { version: '1.3.13', source: 'https://bun.invalid/1.3.13', checksum: sha('a') },
  ahpd: { version: '0.15.0-rc.4', source: 'https://registry.invalid/ahpd-0.15.0-rc.4.tgz', checksum: sha('b') },
  hostPlugin: { version: '0.1.0', source: 'https://registry.invalid/host-0.1.0.tgz', checksum: sha('c') },
  supervisor: { version: '1.34.1', source: 'https://releases.invalid/supervisor-1.34.1.gz', checksum: sha('d') },
};

const bytesOf = (source: string) => `bytes:${source}`;
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

/** Every pin correct for what the fake fetch returns, so a case fails only where it means to. */
const HONEST: InstallPins = {
  runtime: { ...PINS.runtime, checksum: `sha256:${digest(bytesOf(PINS.runtime.source))}` },
  ahpd: { ...PINS.ahpd, checksum: `sha256:${digest(bytesOf(PINS.ahpd.source))}` },
  hostPlugin: { ...PINS.hostPlugin, checksum: `sha256:${digest(bytesOf(PINS.hostPlugin.source))}` },
  supervisor: { ...PINS.supervisor, checksum: `sha256:${digest(bytesOf(PINS.supervisor.source))}` },
};

const manifestWith = (pins: InstallPins = HONEST) => {
  const built = customerInstallManifest({ platform: 'linux', home: '/home/customer', version: '0.15.0-rc.4', pins });
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

const fakeIo = (existing: readonly string[] = [], failing: ReadonlySet<string> = new Set()): Fake => {
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
    list: (path) => children(path),
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
      const bytes = content.get(from);
      content.delete(from);
      if (bytes !== undefined) content.set(to, bytes);
      const mode = modes.get(from);
      modes.delete(from);
      if (mode !== undefined) modes.set(to, mode);
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

const recordOf = (io: Fake, manifest: ReturnType<typeof manifestWith>) =>
  JSON.parse(io.content.get(`${manifest.root}/install.json`) ?? '{}') as { state?: string };

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
    // What runs is what was checked: all four pinned artifacts, each 0755 at its final path.
    for (const name of ['runtime', 'ahpd', 'hostPlugin', 'supervisor'] as const) {
      const entry = manifest.entries.find((one) => one.from === `download:${name}`)!;
      expect(io.modes.get(entry.path)).toBe(0o755);
    }
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
  });

  // @level l3 @consumer the boot item on disk starts `current` and escapes the root for XML.
  it('writes a plist that escapes the root and a unit with WantedBy alone', async () => {
    const macBuilt = customerInstallManifest({ platform: 'darwin', home: '/home/customer', version: '0.15.0-rc.4', pins: HONEST });
    if (!macBuilt.ok) throw new Error('expected a manifest');
    const mac = macBuilt.manifest;
    const macIo = fakeIo();
    await applyInstall(mac, macIo, () => undefined);
    const plist = macIo.content.get(`${mac.root}/boot/launchd-agent`) ?? '';
    expect(plist).toContain('dev.hallohuman.ahpd');
    expect(plist).toContain('current/supervisor');

    const built = customerInstallManifest({ platform: 'darwin', home: '/home/c&d"x', version: '0.15.0-rc.4', pins: HONEST });
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
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).not.toContain('After=default.target');
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
    const built = customerInstallManifest({ platform: 'linux', home: '/home/customer', version: '0.15.0-rc.4', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = { ...built.manifest, pins: { ...built.manifest.pins, ahpd: { ...built.manifest.pins.ahpd, checksum: null } } };
    const io = fakeIo();
    const result = await applyInstall(manifest, io, () => undefined);
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'missing-checksum', download: 'ahpd' });
  });
});

describe('uninstall removes what install wrote, and keeps what it did not (#38280)', () => {
  // @level l3 @consumer the boot item is disabled first, every written entry goes, and an empty folder goes with them.
  it('disables the boot item, then removes the entries in reverse and lists them', () => {
    const manifest = manifestWith();
    const io = fakeIo(manifest.entries.map((entry) => entry.path));
    for (const entry of manifest.entries) if (entry.kind === 'dir') io.dirs.add(entry.path);
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
    const built = customerInstallManifest({ platform: 'linux', home, version: '0.15.0-rc.4', pins: HONEST });
    if (!built.ok) throw new Error('expected a manifest');
    const manifest = built.manifest;
    const real = nodeInstallIo();
    const io: InstallIo = {
      ...real,
      fetchTo: async (source, path) => writeFileSync(path, bytesOf(source)),
      run: (command) => {
        void command;
        return { code: 0, output: '' };
      },
    };
    expect((await applyInstall(manifest, io, () => undefined)).ok).toBe(true);
    // The daemon writes into its state dir, as it will on a real host.
    mkdirSync(`${manifest.root}/state`, { recursive: true });
    writeFileSync(`${manifest.root}/state/sessions.json`, '[]');

    const keptRun = uninstallInstall(manifest, io);
    expect(keptRun.ok).toBe(true);
    expect(keptRun.kept.join('\n')).toContain(`kept ${manifest.root}/state: 1 entry`);
    expect(existsSync(`${manifest.root}/state/sessions.json`)).toBe(true);
    expect(existsSync(`${manifest.root}/install.json`)).toBe(false);
    expect(existsSync(`${manifest.root}/boot`)).toBe(false);

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
});
