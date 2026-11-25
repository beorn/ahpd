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
const SOURCE = './packages/agent-pi/src/index.ts';
const NAME = 'agent-pi';
const optionsSchema = manifest.ahpd.optionsSchema;

/** Options that pass, which each case spoils one key of. */
const VALID: Record<string, unknown> = {};

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
  base: { path: '/tmp/agent-pi-options', agents: [echo({ path: '/tmp/agent-pi-options' })] },
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
    'model',
    'baseUrl',
    'apiKey',
    'hostTools',
    'projectTrust',
    'sessionDir',
  ]);
  const { options: served, problems } = await load(VALID);
  expect(problems).toEqual([]);
  expect(Object.keys(served.engines?.['pi']?.schema.properties ?? {})).toEqual([
    'baseUrl',
    'apiKey',
    'hostTools',
    'env',
    'projectTrust',
    'sessionDir',
  ]);
});

it('declares every option its README lists, and no other', () => {
  expect(declared().sort()).toEqual(documented().sort());
});

it.each<[string, unknown]>([
  ['model', 5],
  ['projectTrust', 'ask'],
  ['sessionDir', 5],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

/*
 * An agent is a record, so the three fields a record carries are refused here.
 *
 * The schema cannot refuse them - they are not in it - so the loader says it
 * does not know the key and lets it through, and `apply` refuses it with a
 * sentence that says where the field is written now.
 */
it.each<[string, string]>([
  ['provider', "the record's id"],
  ['displayName', "the record's name"],
  ['description', "the record's description"],
])('refuses %s, which a record carries now', async (key, where) => {
  const { loaded, problems } = await load({ [key]: 'x' });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain(`plugins.${NAME}.options.${key} is not an option`);
  expect(problems[1]).toContain(`options.${key} is written per record now, as ${where}`);
});
