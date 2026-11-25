import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loggerOf } from '../../sdk/src/log.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins/plugins.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { RETIRED, apply } from '../src/plugin.js';

/*
 * #38277 live test: the plugin did not load on a real daemon ("grants needs the
 * registration to be a key its contracts declare, contracts.grants") because
 * apply() registered grants the manifest did not declare. The other tests drive
 * a stub host that checks no contract; these hand the manifest's own
 * `ahpd.contracts` to the SDK's real plugin host, and fold it as the daemon does.
 */
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { ahpd: { contracts: Record<string, string[]> } };

const load = (options: (dir: string) => Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-services-manifest-'));
  const { host, contribution } = pluginHost('services', {
    path: dir, paths: [dir], version: sdkVersion(), hostName: 'test', configDir: dir, log: loggerOf(() => {}), say: () => {},
  }, { contracts: manifest.ahpd.contracts as never, alert: () => {} });
  apply(host as never, options(dir));
  const folded = foldHostOptions({ path: dir, agents: [{ ...echo({ path: dir, pace: 0 }), provider: 'base', displayName: 'Base' }], resources: fileResources() }, [contribution]);
  return { contribution, folded };
};

it('applies against the SDK\'s plugin host with the contracts its package.json declares, and folds with no problem', () => {
  const { contribution, folded } = load((dir) => {
    writeFileSync(join(dir, 'local.yaml'), 'processes: {}\n');
    return { files: [join(dir, 'local.yaml')], socket: join(dir, 'pc.sock'), machine: 'm' };
  });
  expect(Object.keys(contribution.grants ?? {})).toEqual(['service']);
  expect(Object.keys(contribution.channels)).toEqual(['x-hh-services']);
  expect(Object.keys(contribution.providers).toSorted()).toEqual(['hh-service', 'hh-services']);
  // Every operation's grant is one the plugin registered, which the fold checks (beorn/ahpd#38).
  expect(folded.problems).toEqual([]);
  expect(manifest.ahpd.contracts.methods?.toSorted()).toEqual(Object.keys(RETIRED).toSorted());
});

it('applies with options it cannot read, registering the channel and the old names all the same', () => {
  const { contribution, folded } = load(() => ({}));
  expect(Object.keys(contribution.channels)).toEqual(['x-hh-services']);
  expect(Object.keys(contribution.methods).toSorted()).toEqual(Object.keys(RETIRED).toSorted());
  expect(folded.problems).toEqual([]);
});
