import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { schemaGaps } from '@ahpd/sdk';
import { DECLARED } from '../src/options.js';
import type { Engine, Bag } from '@ahpd/sdk';

/*
 * The engine schema a client reads, against the options a record holds.
 *
 * Every declared option is a property of the engine's schema, so a client that draws a record sees each one. A property is the declaration's own `schema`, so the value a record may carry and the value a session is held to cannot drift.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';

/** The `claude` engine one load registered. */
const engineOf = async (): Promise<Engine> => {
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: '/tmp/ahpd-preset', agents: [echo({ path: '/tmp/ahpd-preset' })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const engine = served.engines?.['claude'];
  if (engine === undefined) throw new Error('no claude engine was registered');
  return engine;
};

it('declares every option a record holds as a property of the engine schema', async () => {
  const properties = ((await engineOf()).schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, one] of Object.entries(DECLARED)) expect(properties[name], name).toEqual(one.schema);
  // Beside the declared options are the three fields a record holds as an agent
  // of this engine rather than as a set of values.
  expect(properties['models']).toMatchObject({
    type: 'array',
    items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] },
  });
  expect(properties['modelSources']).toMatchObject({
    type: 'array',
    items: {
      type: 'object',
      properties: { fetch: { type: 'string' }, match: { type: 'string' }, key: { secret: true } },
      required: ['fetch'],
    },
  });
  expect(properties['keepCliModels']).toMatchObject({ type: 'boolean' });
});

it('names every value of env and every value of a source, with no gap', async () => {
  const properties = ((await engineOf()).schema.properties ?? {}) as Bag;
  expect(properties['env']).toMatchObject({
    type: 'object',
    additionalProperties: {
      oneOf: [
        { type: 'string' },
        { type: 'null' },
        { type: 'object', properties: { fromEnv: { type: 'string' } }, required: ['fromEnv'] },
        { type: 'object', properties: { $secret: { type: 'string' } }, required: ['$secret'] },
      ],
    },
  });
  expect(properties['extraArgs']).toMatchObject({ type: 'object', additionalProperties: {} });
  // Every path a client draws names its value, so the walk finds no hole.
  expect(schemaGaps((await engineOf()).schema)).toEqual([]);
});

it('names the values a record may hold, not only their types', async () => {
  const properties = ((await engineOf()).schema.properties ?? {}) as Bag;
  // What a client draws, and what the channel holds a record to: a preset with
  // thinking 5 used to be checked here, and the schema is what answers now.
  expect(properties['thinking']).toMatchObject({ type: 'string', enum: ['adaptive', 'disabled'] });
  expect(properties['sandbox']).toMatchObject({ enum: ['default', 'on', 'off'] });
});

/*
 * The options and a record's fields in the order a form draws them, by
 * purpose: the model, the prompt, the tools, the run, the machine, and the
 * tuning last. A new field goes in its group.
 */
it('lists its options and a record\'s fields by purpose', async () => {
  const manifest = (await import('../package.json', { with: { type: 'json' } })).default as { ahpd: { optionsSchema: { properties: Record<string, unknown> } } };
  expect(Object.keys(manifest.ahpd.optionsSchema.properties)).toEqual([
    'model', 'hostTools', 'computerExecutable', 'computerCli', 'computerCliFallback', 'computerConfigDir', 'handshakeTimeoutMs',
  ]);
  expect(Object.keys((await engineOf()).schema.properties ?? {})).toEqual([
    'models', 'modelSources', 'keepCliModels',
    'outputStyle', 'thinking',
    'hostTools', 'hostTasks', 'enableTasks',
    'env', 'logins', 'extraArgs', 'sandbox', 'autoAllowBashIfSandboxed',
    'computerConfigDir',
    'cliStart', 'stopEnds', 'dontAsk', 'portFailures', 'subagentsFrom',
    'taskOutputFirstWaitMs', 'taskOutputLongestWaitMs', 'taskOutputQuietReads', 'subagentTitleMax', 'subagentStartTimeoutMs',
    'maxShellInitScript', 'maxTerminalOutputBytes', 'keepFramed', 'watchWaitMs', 'fileMostBytes', 'ruleDepth', 'ruleMost',
  ]);
});
