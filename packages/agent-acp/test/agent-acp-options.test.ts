import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import manifest from '../package.json' with { type: 'json' };

/*
 * The plugin's options, held to the schema its manifest declares.
 *
 * The loader checks them before `apply`, so a value of the wrong type is
 * reported with the plugin's name and the key, and the plugin is skipped
 * without running. The README's options table is what a person configures
 * from, so the schema declares what it lists.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const NAME = 'agent-acp';
const optionsSchema = manifest.ahpd.optionsSchema;

/** Options that pass, which each case spoils one key of. */
const VALID: Record<string, unknown> = { hostTools: false, toolsChanged: 'notify' };

/** The option names the schema declares. */
const declared = (): string[] => Object.keys((optionsSchema as { properties: Record<string, unknown> }).properties);

/** The option names the first options table in the README lists. */
const documented = (): string[] => {
  const lines = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\| option \|/iu.test(line));
  const names: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const found = /^\| `([^`]+)` \|/u.exec(line);
    if (found?.[1] !== undefined) names.push(found[1]);
  }
  return names;
};

const load = (options: Record<string, unknown>) => loadPlugins([{ name: SOURCE, options }], {
  base: { path: '/tmp/agent-acp-options', agents: [echo({ path: '/tmp/agent-acp-options' })] },
  configDir: REPO,
  cwd: REPO,
  log: () => {},
});

/*
 * The options and a record's fields in the order a form draws them, by
 * purpose: the model, the prompt, the tools, the run, the folders, the
 * machine, and the tuning last. A new field goes in its group.
 */
it('lists its options and a record\'s fields by purpose', async () => {
  expect(declared()).toEqual([
    'hostTools',
    'toolsChanged',
  ]);
  const { options: served, problems } = await load(VALID);
  expect(problems).toEqual([]);
  expect(Object.keys(served.engines?.['acp']?.schema.properties ?? {})).toEqual([
    'hostTools',
    'toolsChanged',
    'base',
    'command',
    'args',
    'install',
    'page',
    'env',
    'cwd',
    // This fork's ACP custody fields, beside the process they configure.
    'sessionIdEnv',
    'spawnGuard',
    'authenticate',
    'honoursTrust',
    'machine',
    'portFailures',
    'cutTurns',
    'stderrTail',
    'modes',
    'unreportedClientCalls',
    'findFreshMs',
    'listingIdleMs',
    'sessionListMaxPages',
    'exitGraceMs',
    'stderrBytes',
    'killGraceMs',
    'closeGraceMs',
  ]);
});

it('declares every option its README lists, and no other', () => {
  expect(declared().sort()).toEqual(documented().sort());
});

it.each<[string, unknown]>([
  ['hostTools', 5],
  ['toolsChanged', 5],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

it('loads with no options at all, since each agent is a record', async () => {
  const { loaded, problems } = await load({});
  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
});

it('passes an option it does not know through, naming it', async () => {
  const { problems } = await load({ ...VALID, presets: {} });
  expect(problems.join('\n')).toContain(`plugins.${NAME}.options.presets is not an option ${NAME} knows; passed through`);
});
