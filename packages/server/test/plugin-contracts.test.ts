/*
 * Every plugin this repository ships loads under its own contracts.
 *
 * The contracts are in the `ahpd` field of the package.json the loader reads,
 * and the check runs at the moment the plugin registers: a name the list does
 * not cover fails that plugin's load, so a load with no contract problem is
 * the list being complete.
 *
 * Each package is loaded as a copy of its package.json whose entry re-exports
 * its `src`, because the tests run before `pnpm build` and the loader refuses
 * an entry outside the package.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

const here = import.meta.dirname;
const repo = join(here, '../../..');

/** Every plugin package in this repository, by the directory it is. */
const SHIPPED = [
  'activepieces',
  'agent-acp',
  'agent-claude',
  'agent-cofold',
  'agent-pi',
  'bot',
  'computer',
  'push',
  'tasks',
  'tunnel-devtunnel',
  'webhook',
];

/**
 * What a plugin needs to apply with nothing of a person's configuration.
 *
 * ACP has no agent to register without a preset, and a preset of its own with
 * a command reaches no vendor's environment; cofold's store is held in memory
 * rather than written under the temporary configuration directory.
 */
const OPTIONS: Record<string, Record<string, unknown>> = {
  activepieces: { pieces: ['@activepieces/piece-resend'] },
  'agent-acp': { presets: { 'acp-probe': { command: 'acp-probe' } } },
  'agent-cofold': { memory: true },
};

const base = (configDir: string): HostOptions => ({ path: configDir, agents: [echo({ path: configDir })] });

/** A package in `dir` with the shipped package.json, whose entry is the shipped `src`. */
const sourcePackage = (packageName: string, dir: string): string => {
  const shipped = join(repo, 'packages', packageName);
  const json = JSON.parse(readFileSync(join(shipped, 'package.json'), 'utf8')) as Record<string, any>;
  json['ahpd'] = { ...json['ahpd'], entry: './index.ts' };
  delete json['exports'];
  delete json['main'];
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json));
  writeFileSync(join(dir, 'index.ts'), `export * from ${JSON.stringify(pathToFileURL(join(shipped, 'src/index.ts')).href)};\n`);
  return dir;
};

describe('every shipped plugin declares its contracts', () => {
  it.each(SHIPPED)('%s loads with no contract problem', async (packageName) => {
    const configDir = mkdtempSync(join(tmpdir(), 'ahpd-contracts-'));
    try {
      const options = OPTIONS[packageName];
      const spec: PluginSpec = {
        name: sourcePackage(packageName, mkdtempSync(join(configDir, 'package-'))),
        ...(options === undefined ? {} : { options }),
      };
      const { loaded, problems } = await loadPlugins([spec], {
        base: base(configDir),
        configDir,
        cwd: repo,
        log: () => {},
      });

      expect(problems.filter((line) => line.includes('contracts'))).toEqual([]);
      // And the shipped manifest's grants cover what it registers: a plugin
      // that gains a channel or a method without its list is a refusal at load
      // on a real host, so it is one here first.
      expect(problems.filter((line) => line.includes('PLUGIN_GRANTS_UNDECLARED') || line.includes('callerGrants'))).toEqual([]);
      expect(loaded).toHaveLength(1);
      // The list the check ran against is the package.json's, so a package whose
      // contracts were dropped is a failure here rather than a quiet pass.
      expect(loaded[0]?.manifest?.contracts).toBeDefined();
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
