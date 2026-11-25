import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyInstall,
  customerInstallManifest,
  describeApplyRefusal,
  installDeployLayout,
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

/** Bytes a fetch "downloads": the source's name, so a mismatch and a match are both easy to arrange. */
const bytesOf = (source: string) => `bytes:${source}`;
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

const manifestWith = (checksums: Partial<InstallPins> = {}) => {
  const built = customerInstallManifest({ platform: 'linux', home: '/home/customer', version: '0.15.0-rc.4', pins: { ...PINS, ...checksums } });
  if (!built.ok) throw new Error('expected a manifest: ' + JSON.stringify(built.refusals));
  return built.manifest;
};

interface Fake extends InstallIo {
  readonly paths: Set<string>;
  readonly commands: string[];
}

const fakeIo = (existing: readonly string[] = []): Fake => {
  const paths = new Set<string>(existing);
  const commands: string[] = [];
  const content = new Map<string, string>();
  return {
    paths,
    commands,
    exists: (path) => paths.has(path),
    mkdir: (path) => paths.add(path),
    writeFile: (path, bytes) => {
      paths.add(path);
      content.set(path, bytes);
    },
    fetchTo: async (source, path) => {
      paths.add(path);
      content.set(path, bytesOf(source));
    },
    move: (from, to) => {
      paths.delete(from);
      paths.add(to);
      const bytes = content.get(from);
      content.delete(from);
      if (bytes !== undefined) content.set(to, bytes);
    },
    remove: (path) => {
      paths.delete(path);
      content.delete(path);
    },
    run: (command) => {
      commands.push(command);
      return { code: 0, output: '' };
    },
    hash: (path) => digest(content.get(path) ?? ''),
  };
};

describe('apply writes the plan, and refuses what it must (#38280)', () => {
  // @level l3 @consumer a root this install did not create is never adopted, $AHPD_HOME included.
  it('refuses a foreign root and changes nothing', () => {
    const manifest = manifestWith();
    const io = fakeIo([manifest.root]);
    return applyInstall(manifest, io, () => undefined).then((result) => {
      expect(result.ok).toBe(false);
      expect(result.refusal).toMatchObject({ kind: 'foreign-root', path: manifest.root });
      expect(result.wrote).toEqual([]);
      expect(describeApplyRefusal(result.refusal!)).toContain('did not create it');
      // Nothing but the pre-existing root itself: no dirs, no downloads, no switch.
      expect([...io.paths]).toEqual([manifest.root]);
      expect(io.commands).toEqual([]);
    });
  });

  // @level l3 @consumer every directory, the four verified downloads, install.json, the switch, then the boot item.
  it('creates every entry, switches through the deploy layout, and enables the boot item last', async () => {
    const manifest = manifestWith({
      runtime: { ...PINS.runtime, checksum: `sha256:${digest(bytesOf(PINS.runtime.source))}` },
      ahpd: { ...PINS.ahpd, checksum: `sha256:${digest(bytesOf(PINS.ahpd.source))}` },
      hostPlugin: { ...PINS.hostPlugin, checksum: `sha256:${digest(bytesOf(PINS.hostPlugin.source))}` },
      supervisor: { ...PINS.supervisor, checksum: `sha256:${digest(bytesOf(PINS.supervisor.source))}` },
    });
    const io = fakeIo();
    const switches: { layout: unknown; version: string; reason: string }[] = [];
    const result = await applyInstall(manifest, io, (layout, version, reason) => {
      switches.push({ layout, version, reason });
    });
    expect(result.ok).toBe(true);
    expect(result.wrote).toContain(`${manifest.root}/install.json`);
    // Plan and apply are one list: nothing is written that the customer was not shown.
    const plan = renderInstallPlan(manifest).join('\n');
    for (const path of result.wrote) expect(plan).toContain(path);
    expect(switches).toEqual([
      { layout: installDeployLayout(manifest), version: '0.15.0-rc.4', reason: 'customer host install' },
    ]);
    expect(io.commands).toEqual([manifest.bootItem.enable]);
    // The staging name a fetch writes never survives a successful apply.
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
  });

  // @level l3 @consumer a download that does not match its pin stops the install by name, before it is placed.
  it('refuses a download whose bytes do not match the pinned checksum', async () => {
    const manifest = manifestWith({
      runtime: { ...PINS.runtime, checksum: `sha256:${digest(bytesOf(PINS.runtime.source))}` },
      ahpd: { ...PINS.ahpd, checksum: sha('f') },
    });
    const io = fakeIo();
    const switches: string[] = [];
    const result = await applyInstall(manifest, io, (_layout, version) => {
      switches.push(version);
    });
    expect(result.ok).toBe(false);
    expect(result.refusal).toMatchObject({ kind: 'checksum-mismatch', download: 'ahpd' });
    expect(describeApplyRefusal(result.refusal!)).toContain('does not match its pinned checksum');
    expect([...io.paths].some((path) => path.endsWith('.download'))).toBe(false);
    expect([...io.paths]).not.toContain(`${manifest.root}/install.json`);
    expect(switches).toEqual([]);
    expect(io.commands).toEqual([]);
  });
});

describe('uninstall removes exactly what install recorded (#38280)', () => {
  // @level l3 @consumer the boot item is disabled first, then every entry goes, last created first.
  it('disables the boot item, then removes the entries in reverse and lists them', () => {
    const manifest = manifestWith();
    const io = fakeIo([...manifest.entries.map((entry) => entry.path)]);
    const result = uninstallInstall(manifest, io);
    expect(result.ok).toBe(true);
    expect(io.commands).toEqual([manifest.bootItem.disable]);
    expect(result.removed).toEqual([...manifest.entries.map((entry) => entry.path)].reverse());
    expect([...io.paths]).toEqual([]);
  });
});
