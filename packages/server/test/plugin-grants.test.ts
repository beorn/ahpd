/*
 * A plugin says what its callers will be asked for, and the host holds it to
 * that.
 *
 * The manifest's `callerGrants` is the set the plugin's channels, methods and
 * tunnel kinds require, and the loader advertises each one in `ahpd.grants` so
 * a role editor lists it before a caller is refused. A plugin that declares the
 * field is held to it: a registration asking for a grant the list does not name
 * is a named refusal at load, `PLUGIN_GRANTS_UNDECLARED`, because a list that
 * under-declares is worse than none - a person reads what the plugin asks of
 * roles and it then asks for more. A plugin written before the field existed
 * still loads, and one line names every grant it needs, with the whole list.
 *
 * The manifest's `grants` is the other list - what the plugin's own connection
 * needs - and nothing in this file is about it except that the two do not
 * stand in for each other.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

const base = (configDir: string): HostOptions => ({ path: configDir, agents: [echo({ path: configDir })] });

/**
 * A package that serves `probe:list` on two channels and `probe:put` on a
 * third, with the `ahpd` field the test hands it.
 *
 * Two channels over one grant are the case a warning per registration repeats
 * itself on, which is what the no-field case below is about.
 */
const fixture = (dir: string, ahpd: Record<string, unknown>): string => {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'probe-grants',
    version: '1.0.0',
    type: 'module',
    peerDependencies: { '@ahpd/sdk': '*' },
    ahpd: { entry: './index.ts', ...ahpd },
  }));
  writeFileSync(join(dir, 'index.ts'), [
    "export const name = 'probe-grants'",
    'export const apply = (host) => {',
    "  host.registerChannel('x-probe', { grant: 'probe:list', snapshot: (uri) => ({ uri }) })",
    "  host.registerChannel('x-probe-two', { grant: 'probe:list', snapshot: (uri) => ({ uri }) })",
    "  host.registerChannel('x-probe-put', { grant: 'probe:put', snapshot: (uri) => ({ uri }) })",
    '}',
    '',
  ].join('\n'));
  return dir;
};

/** Load one fixture and answer what the loader said about it. */
const load = async (ahpd: Record<string, unknown>) => {
  const configDir = mkdtempSync(join(tmpdir(), 'ahpd-grants-'));
  const spec: PluginSpec = { name: fixture(mkdtempSync(join(configDir, 'package-')), ahpd) };
  const loaded = await loadPlugins([spec], { base: base(configDir), configDir, cwd: configDir, log: () => {} });
  return { ...loaded, configDir };
};

describe('a plugin declares what its callers are asked for', () => {
  it('loads when its manifest names every grant its registrations need', async () => {
    const { loaded, problems, configDir } = await load({ callerGrants: ['probe:list', 'probe:put'] });
    try {
      expect(problems.filter((line) => line.includes('declares no callerGrants') || line.includes('PLUGIN_GRANTS_UNDECLARED'))).toEqual([]);
      expect(loaded).toHaveLength(1);
      // The list the check ran against is the manifest's, so a package whose
      // grants were dropped is a failure here rather than a quiet pass.
      expect(loaded[0]?.manifest?.callerGrants).toEqual(['probe:list', 'probe:put']);
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('advertises the declared grants, so no role editor is missing them', async () => {
    const { options, problems, configDir } = await load({ callerGrants: ['probe:list', 'probe:put'] });
    try {
      // `probe` is a scheme this plugin never registers as a provider, so the
      // catalogue entry exists only because the manifest declared it.
      expect(options.grants?.probe).toBeDefined();
      // Both are operations on a scheme nothing serves, so both are advertised
      // by name: the entry a role editor draws has something to tick.
      expect(options.grants?.probe?.operations).toEqual(expect.arrayContaining(['list', 'put']));
      expect(problems.filter((line) => line.includes('which no entry of ahpd.grants lists'))).toEqual([]);
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused by name when its manifest declares grants that do not cover what it serves', async () => {
    const { loaded, problems, configDir } = await load({ callerGrants: ['probe:list'] });
    try {
      expect(loaded).toHaveLength(0);
      const said = problems.join('\n');
      expect(said).toContain('PLUGIN_GRANTS_UNDECLARED');
      expect(said).toContain('probe:put');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('does not advertise a grant nothing it registers requires, and says which', async () => {
    // Two shapes of the same harm: `other:put` would create another plugin's
    // subject, and `probe:nuke` would add to a subject this plugin already
    // serves one operation of. Both would be drawn and never asked for. The
    // plugin still loads - its list covers what it serves - and both are said.
    const { options, problems, loaded, configDir } = await load({ callerGrants: ['probe:list', 'probe:put', 'probe:nuke', 'other:put'] });
    try {
      expect(loaded).toHaveLength(1);
      expect(options.grants?.other).toBeUndefined();
      expect(options.grants?.probe?.operations).not.toContain('nuke');
      const said = problems.join('\n');
      expect(said).toContain('declares callerGrants other:put, but nothing it registers on other asks for it');
      expect(said).toContain('declares callerGrants probe:nuke, but nothing it registers on probe asks for it');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('refuses at read a word the built-in table does not have, naming what it does', async () => {
    // `session` is the table's, so its entry is drawn from the table and
    // nothing a manifest writes can widen it. A word the table lacks is a
    // refusal the author can act on, not a line that drops the word and lets
    // the plugin load as if the manifest had said nothing.
    const { loaded, problems, configDir } = await load({ callerGrants: ['probe:list', 'probe:put', 'session:teleport'] });
    try {
      expect(loaded).toHaveLength(0);
      expect(problems.join('\n')).toContain("session:teleport is not one of session's operations");
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused when it declares an empty list and serves something', async () => {
    const { loaded, problems, configDir } = await load({ callerGrants: [] });
    try {
      expect(loaded).toHaveLength(0);
      expect(problems.join('\n')).toContain('PLUGIN_GRANTS_UNDECLARED');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('reads a declared group as covering the operations it groups', async () => {
    // `probe:read` is what a role would hold for `probe:list`, and the gate
    // answers it that way, so the coverage check asks the same question rather
    // than comparing words.
    const { options, loaded, problems, configDir } = await load({ callerGrants: ['probe:read', 'probe:write'] });
    try {
      expect(loaded).toHaveLength(1);
      expect(problems.filter((line) => line.includes('PLUGIN_GRANTS_UNDECLARED'))).toEqual([]);
      // What the registrations need is what a role editor can tick, so the
      // entry has operations even though the manifest named only groups.
      expect(options.grants?.probe?.operations).toEqual(expect.arrayContaining(['list', 'put']));
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused when it declares the field and a registration asks for a wildcard', async () => {
    // No declaration can name `probe:*`, so the list would read as covering
    // nothing while the registration asks for everything. One advisory line
    // would let a plugin load that no declaration can describe.
    const configDir = mkdtempSync(join(tmpdir(), 'ahpd-grants-'));
    const dir = mkdtempSync(join(configDir, 'package-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'probe-wildcard',
      version: '1.0.0',
      type: 'module',
      peerDependencies: { '@ahpd/sdk': '*' },
      ahpd: { entry: './index.ts', callerGrants: ['probe:list'] },
    }));
    writeFileSync(join(dir, 'index.ts'), [
      "export const name = 'probe-wildcard'",
      'export const apply = (host) => {',
      "  host.registerChannel('x-probe', { grant: 'probe:*', snapshot: (uri) => ({ uri }) })",
      '}',
      '',
    ].join('\n'));
    try {
      const loaded = await loadPlugins([{ name: dir }], { base: base(configDir), configDir, cwd: configDir, log: () => {} });
      expect(loaded.loaded).toHaveLength(0);
      expect(loaded.problems.join('\n')).toContain('PLUGIN_GRANTS_UNDECLARED');
      expect(loaded.problems.join('\n')).toContain('probe:*');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('draws a required operation a provider does not serve, and reports one nothing asks for', async () => {
    // The provider draws `notes` from its own methods; a channel asking for
    // an operation it does not serve still has to be drawn, or a role cannot
    // be given what the channel asks for. A declared word neither asks for is
    // reported, because install prints the list as what roles must hold.
    const configDir = mkdtempSync(join(tmpdir(), 'ahpd-grants-'));
    const dir = mkdtempSync(join(configDir, 'package-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'probe-provider',
      version: '1.0.0',
      type: 'module',
      peerDependencies: { '@ahpd/sdk': '*' },
      ahpd: { entry: './index.ts', callerGrants: ['notes:read', 'notes:export', 'notes:pin'] },
    }));
    writeFileSync(join(dir, 'index.ts'), [
      "export const name = 'probe-provider'",
      'export const apply = (host) => {',
      "  host.registerResourceProvider('notes', { read: () => ({ uri: 'notes://all', data: '' }), write: () => ({}) })",
      "  host.registerChannel('x-notes-export', { grant: 'notes:export', snapshot: (uri) => ({ uri }) })",
      '}',
      '',
    ].join('\n'));
    try {
      const loaded = await loadPlugins([{ name: dir }], { base: base(configDir), configDir, cwd: configDir, log: () => {} });
      expect(loaded.loaded).toHaveLength(1);
      const entry = loaded.options.grants?.['notes'];
      // The returned operation is joined to the registry, not put in place of
      // it: the provider is still the subject's owner, and `grantEntries`
      // unions its operations with what is registered here.
      expect(entry?.operations).toEqual(expect.arrayContaining(['export']));
      expect(loaded.options.resourceProviders?.notes).toBeDefined();
      expect(entry?.operations).not.toContain('pin');
      expect(loaded.problems.join('\n')).toContain('declares callerGrants notes:pin, but nothing it registers on notes asks for it');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('loads with one line naming every grant it needs when the manifest has no field at all', async () => {
    const { loaded, problems, configDir } = await load({});
    try {
      expect(loaded).toHaveLength(1);
      const said = problems.filter((line) => line.includes('declares no callerGrants'));
      // One line per plugin, not one per registration: two of the three
      // channels need the same grant, and the advice is the whole list.
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('probe:list, probe:put');
      expect(said[0]).toContain('"callerGrants": ["probe:list", "probe:put"]');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused at read when a grants entry is not a grant', async () => {
    const { loaded, problems, configDir } = await load({ callerGrants: ['probe'] });
    try {
      expect(loaded).toHaveLength(0);
      expect(problems.join('\n')).toContain('that probe is not <subject>:<operation>');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused at read when a grants entry is a wildcard', async () => {
    const { loaded, problems, configDir } = await load({ callerGrants: ['probe:*'] });
    try {
      expect(loaded).toHaveLength(0);
      expect(problems.join('\n')).toContain('which is a wildcard');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('is refused at read when the subject is the wildcard', async () => {
    // `grantProblem` accepts `*:write`, which a role may hold; a manifest names
    // the subject it introduces, so install can never write it into an entry.
    const { loaded, problems, configDir } = await load({ grants: ['*:write'] });
    try {
      expect(loaded).toHaveLength(0);
      expect(problems.join('\n')).toContain('which is a wildcard');
    }
    finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

/*
 * A plugin refused after `apply` returned is a plugin the set never holds, so
 * nothing else runs its closers: the loader runs them itself.
 */
it('closes what the plugin opened when its declaration refuses it', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'ahpd-grants-'));
  const dir = mkdtempSync(join(configDir, 'package-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'probe-closing',
    version: '1.0.0',
    type: 'module',
    peerDependencies: { '@ahpd/sdk': '*' },
    ahpd: { entry: './index.ts', callerGrants: [] },
  }));
  writeFileSync(join(dir, 'index.ts'), [
    "import { writeFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'probe-closing'",
    'export const apply = (host) => {',
    "  host.registerChannel('x-probe', { grant: 'probe:list', snapshot: (uri) => ({ uri }) })",
    "  host.registerClose(() => { writeFileSync(join(host.path, 'closed.txt'), 'closed') })",
    '}',
    '',
  ].join('\n'));
  const spec: PluginSpec = { name: dir };
  const { loaded, problems } = await loadPlugins([spec], { base: base(configDir), configDir, cwd: configDir, log: () => {} });
  try {
    expect(loaded).toHaveLength(0);
    expect(problems.join('\n')).toContain('PLUGIN_GRANTS_UNDECLARED');
    expect(existsSync(join(configDir, 'closed.txt'))).toBe(true);
  }
  finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
