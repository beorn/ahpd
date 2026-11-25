import { mkdirSync, mkdtempSync, readlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  customerInstallManifest,
  describeRefusal,
  installDeployLayout,
  removalList,
  renderInstallPlan,
  switchCurrent,
  type InstallPins,
} from '../src/index.js';

const PINS: InstallPins = {
  runtime: { version: '1.3.13', source: 'https://bun.sh/download/1.3.13/darwin-aarch64', checksum: 'sha256:aaaaaaaa' },
  ahpd: { version: '0.15.0-rc.4', source: 'npm:@ahpd/server@0.15.0-rc.4', checksum: 'sha512-bbbb' },
  hostPlugin: { version: '0.1.0', source: 'npm:@hh/ahpd-host@0.1.0', checksum: 'sha512-cccc' },
  supervisor: { version: '1.34.1', source: 'https://github.com/f1bonacc1/process-compose/releases/download/v1.34.1/process-compose_darwin_arm64.tar.gz', checksum: 'sha256:dddd' },
};

const manifestFor = (platform: 'darwin' | 'linux', overrides: Partial<InstallPins> = {}) => {
  const built = customerInstallManifest({
    platform,
    home: '/home/customer',
    configHome: '/home/customer/.config',
    version: '0.15.0-rc.4',
    pins: { ...PINS, ...overrides },
  });
  if (!built.ok) throw new Error('expected a manifest, got ' + JSON.stringify(built.refusals));
  return built.manifest;
};

describe('customer host install manifest (#38280)', () => {
  // @level l3 @consumer the plan a customer reads before anything is created, and what `uninstall` will remove.
  it('names every path it will create, under one folder the user owns', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const manifest = manifestFor(platform);
      const plan = renderInstallPlan(manifest).join('\n');
      expect(manifest.root).toBe('/home/customer/.ahpd');
      for (const entry of manifest.entries) expect(plan).toContain(entry.path);
      // The boot item is the one thing outside the root, and it is recorded so removal is exact.
      const outside = manifest.entries.filter(
        (entry) => entry.path !== manifest.root && !entry.path.startsWith(manifest.root + '/'),
      );
      expect(outside).toHaveLength(1);
      expect(outside[0].kind).toBe('boot-item');
    }
  });

  // @level l3 @consumer the boot item per platform: a launchd agent on Mac, a systemd *user* unit on Linux.
  it('boots in the user session, never system-wide, and the plan shows the enable command', () => {
    const mac = manifestFor('darwin');
    expect(mac.bootItem.kind).toBe('launchd-agent');
    expect(mac.bootItem.path).toBe('/home/customer/Library/LaunchAgents/dev.hallohuman.ahpd.plist');
    expect(renderInstallPlan(mac).join('\n')).toContain(mac.bootItem.enable);

    const linux = manifestFor('linux');
    expect(linux.bootItem.kind).toBe('systemd-user-unit');
    expect(linux.bootItem.path).toBe('/home/customer/.config/systemd/user/ahpd.service');
    expect(linux.bootItem.enable).toBe('systemctl --user enable --now ahpd.service');
    expect(renderInstallPlan(linux).join('\n')).toContain('systemctl --user enable --now ahpd.service');
  });

  // @level l3 @consumer every download is pinned and checked: version, source and checksum are all in the plan.
  it('prints each download with its exact version and its checksum', () => {
    const plan = renderInstallPlan(manifestFor('darwin')).join('\n');
    for (const [name, pin] of Object.entries(PINS)) {
      expect(plan).toContain(`fetch ${name} ${pin.version} from ${pin.source}`);
      expect(plan).toContain(`verify ${pin.checksum}`);
    }
  });

  // @level l3 @consumer the refusal a customer sees when a publisher has not published a checksum yet.
  it('refuses a download with no checksum, by name, instead of fetching it unchecked', () => {
    const built = customerInstallManifest({
      platform: 'darwin',
      home: '/home/customer',
      version: '0.15.0-rc.4',
      pins: { ...PINS, runtime: { ...PINS.runtime, checksum: null } },
    });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('unreachable');
    expect(built.refusals).toEqual([{ kind: 'missing-checksum', download: 'runtime' }]);
    expect(describeRefusal(built.refusals[0])).toContain('runtime has no published checksum');
  });

  // @level l3 @consumer a floating version is refused before a plan exists, so nothing fetches "latest".
  it('refuses a version that is not exact', () => {
    const built = customerInstallManifest({
      platform: 'linux',
      home: '/home/customer',
      version: '0.15.0-rc.4',
      pins: { ...PINS, ahpd: { ...PINS.ahpd, version: 'latest' } },
    });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('unreachable');
    expect(built.refusals).toEqual([{ kind: 'unpinned-version', download: 'ahpd', version: 'latest' }]);
  });

  // @level l3 @consumer $AHPD_HOME moves the one folder, and nothing else moves with it.
  it('honours an explicit root and keeps the boot item where the platform puts it', () => {
    const built = customerInstallManifest({
      platform: 'linux',
      home: '/home/customer',
      root: '/data/ahpd',
      version: '0.15.0-rc.4',
      pins: PINS,
    });
    if (!built.ok) throw new Error('expected a manifest');
    expect(built.manifest.root).toBe('/data/ahpd');
    expect(built.manifest.bootItem.path).toBe('/home/customer/.config/systemd/user/ahpd.service');
    for (const entry of built.manifest.entries.filter((one) => one.kind !== 'boot-item'))
      expect(entry.path.startsWith('/data/ahpd')).toBe(true);
  });

  // @level l3 @consumer install and uninstall read one list: removal is the creation list backwards, nothing else.
  it('derives removal from the same entries, in reverse', () => {
    const manifest = manifestFor('darwin');
    expect(removalList(manifest)).toEqual([...manifest.entries].reverse());
    expect(removalList(manifest)).toHaveLength(manifest.entries.length);
    expect(renderInstallPlan(manifest).at(-1)).toContain(String(manifest.entries.length));
  });
});

describe('switchCurrent is the deploy switch, not a second copy (#38276, #38280)', () => {
  // @level l3 @consumer a customer install places prebuilt releases and switches them through this one rename.
  it('points current at the release the install placed, where the manifest said it would be', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-install-')));
    const built = customerInstallManifest({ platform: 'linux', home, version: '0.15.0-rc.4', pins: PINS });
    if (!built.ok) throw new Error('expected a manifest, got ' + JSON.stringify(built.refusals));
    const manifest = built.manifest;
    const currentEntry = manifest.entries.find((entry) => entry.kind === 'symlink');
    if (!currentEntry) throw new Error('the manifest names no current symlink');
    mkdirSync(join(manifest.root, 'state', 'deploy', 'ahpd', 'releases', '0.15.0-rc.4'), { recursive: true });
    switchCurrent(installDeployLayout(manifest), '0.15.0-rc.4');
    expect(currentEntry.path).toBe(join(manifest.root, 'state', 'deploy', 'ahpd', 'current'));
    expect(readlinkSync(currentEntry.path)).toBe('releases/0.15.0-rc.4');
  });
});
