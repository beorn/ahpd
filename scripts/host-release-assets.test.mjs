/*
 * The names and the pin-base of a customer-host release, held to the route and the pack script's rules.
 *
 * A name this file gets wrong is a 404 for a customer (hightea's host-release route refuses anything it does not
 * recognise), and a pin-base the pack script refuses stops a cut half-way. Neither needs a download to check.
 */
import { describe, expect, it } from 'vitest';
import { TAG, ahpdVersion, assetNames, inContract, pinBase } from './host-release-assets.mjs';

const versions = { version: '0.15.0-beorn.abcdef12', runtimeVersion: '1.4.4', supervisorVersion: '1.122.0', pluginVersion: '0.1.28' };
const checksums = Object.fromEntries(
  ['bun-linux-x64', 'host-plugin-0.1.28.js', 'supervisor-1.122.0-linux-x64'].map((name) => [name, 'a'.repeat(64)]),
);

describe('the six names match the host-release route', () => {
  for (const target of ['linux-x64', 'darwin-arm64']) {
    it(`answers every name for ${target}`, () => {
      const names = assetNames({ ...versions, target });
      expect(Object.values(names)).toHaveLength(6);
      for (const name of Object.values(names)) expect(inContract(name), name).toBe(true);
      expect(names.archive).toBe(`ahpd-0.15.0-beorn.abcdef12-${target}.tar.gz`);
      expect(names.pins).toBe(`pins-${target}.json`);
      expect(names.runtime).toBe(`bun-${target}`);
      expect(names.deploy).toBe('ahpd-deploy-0.15.0-beorn.abcdef12.tgz');
      expect(names.plugin).toBe('host-plugin-0.1.28.js');
      expect(names.supervisor).toBe(`supervisor-1.122.0-${target}`);
    });
  }

  it('refuses a near miss rather than answering it', () => {
    // `ahpd-0.15.0-linux-x64.tar.gz` is NOT a near miss: the route's own version pattern reads `-linux-x64` as a
    // pre-release part, so it answers it. This test holds only the names the route refuses; changing that is upstream.
    for (const name of [
      'bun-linux-amd64',
      'pins-linux-x64.jsonx',
      'supervisor-1.122.0-linux-x64.tgz',
      'host-plugin-0.1.28-dev.abc.txt',
      'ahpd-deploy-0.15.0.zip',
    ]) {
      expect(inContract(name), name).toBe(false);
    }
  });

  it('accepts the tag shape and only that', () => {
    expect(TAG.test('hh-38280-abcdef12')).toBe(true);
    expect(TAG.test('hh-38280-ABCDEF12')).toBe(false);
    expect(TAG.test('hh-38280-abcdef1')).toBe(false);
  });
});

describe('the pin-base is the shape the pack script validates', () => {
  const base = pinBase({
    version: '0.15.0-beorn.abcdef12',
    platform: 'linux',
    arch: 'x64',
    tag: 'hh-38280-abcdef12',
    sourceBase: 'https://hightea.ai/hosts/',
    names: assetNames({ ...versions, target: 'linux-x64' }),
    versions: { runtime: '1.4.4', hostPlugin: '0.1.28', supervisor: '1.122.0' },
    checksums,
  });

  it('holds exactly the three pins the pack script consumes, and adds ahpd itself', () => {
    expect(Object.keys(base.pins).sort()).toEqual(['hostPlugin', 'runtime', 'supervisor']);
  });

  it('names one https source under the tag for each pin, with a measured sha256', () => {
    for (const pin of Object.values(base.pins)) {
      expect(pin.source.startsWith('https://hightea.ai/hosts/hh-38280-abcdef12/')).toBe(true);
      expect(pin.source).not.toContain('//hh-');
      expect(pin.checksum).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(pin.version).toMatch(/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u);
    }
    expect(base.pins.runtime.source).toBe('https://hightea.ai/hosts/hh-38280-abcdef12/bun-linux-x64');
  });

  it('carries the machine on the two pin that are machine-specific, and not on the plug-in', () => {
    expect(base.pins.runtime).toMatchObject({ platform: 'linux', arch: 'x64' });
    expect(base.pins.supervisor).toMatchObject({ platform: 'linux', arch: 'x64' });
    expect(base.pins.hostPlugin.platform).toBeUndefined();
    expect(base.pins.hostPlugin.arch).toBeUndefined();
  });
});

describe('the ahpd version', () => {
  it('is the server version plus the commit, the pack script formula', () => {
    expect(ahpdVersion('0.15.0', 'abcdef1234567890')).toBe('0.15.0-beorn.abcdef12');
  });
});
