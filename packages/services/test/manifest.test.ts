import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loggerOf } from '../../sdk/src/log.js';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { apply, METHODS } from '../src/plugin.js';

/*
 * #38277 live test: the plugin did not load on a real daemon ("grants needs the
 * registration to be a key its contracts declare, contracts.grants") because
 * apply() registers the `services` grants and the manifest did not declare them.
 * The other tests drive a stub host that checks no contract; this one hands the
 * manifest's own `ahpd.contracts` to the SDK's real plugin host.
 */
it("applies against the SDK's plugin host with the contracts its package.json declares", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { ahpd: { contracts: Record<string, string[]> } };
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-services-manifest-'));
  const { host, contribution } = pluginHost('services', {
    path: dir, paths: [dir], version: sdkVersion(), hostName: 'test', configDir: dir, log: loggerOf(() => {}), say: () => {},
  }, { contracts: manifest.ahpd.contracts as never, alert: () => {} });
  // Options that cannot be read still register every method (each answering NOT_CONFIGURED), so all of apply runs.
  expect(() => apply(host as never, {})).not.toThrow();
  expect(Object.keys(contribution.grants ?? {})).toEqual(['services']);
  expect(manifest.ahpd.contracts.methods?.toSorted()).toEqual([...METHODS].toSorted());
});
