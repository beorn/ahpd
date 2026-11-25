import { describe, expect, it } from 'vitest';
import {
  createdModelOptionsOf, describeCreateSessionModelOptions, resolveCreatedModelSelection, sessionModelOptionsOf,
} from '../src/tools/modeloptions.js';
import { createSessionModelChoices } from '../src/tools/session.js';
import type { CatalogModel } from '../src/tools/modeloptions.js';

/*
 * The model options `create_session` takes, checked as VS Code's host checks
 * them, with its messages.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1028-L1131
 */

const deep: CatalogModel = {
  id: 'deep', name: 'Deep', provider: 'claude',
  configSchema: { type: 'object', properties: {
    thinkingLevel: { type: 'string', enum: ['low', 'high'], enumLabels: ['Low', 'High'], default: 'high' },
    contextSize: { type: 'number', enum: [200000, 1000000] },
  } },
};
const locked: CatalogModel = {
  id: 'locked', name: 'Locked', provider: 'claude',
  configSchema: { type: 'object', properties: { thinkingLevel: { type: 'string', enum: ['low', 'high'], readOnly: true } } },
};
const flat: CatalogModel = { id: 'flat', name: 'Flat', provider: 'claude' };
const catalog = () => [deep, locked, flat];

describe('the key', () => {
  it('reads off for anything but inline and tool', () => {
    expect(sessionModelOptionsOf(undefined)).toBe('off');
    expect(sessionModelOptionsOf({ sessionModelOptions: 'yes' })).toBe('off');
    expect(sessionModelOptionsOf({ sessionModelOptions: 'inline' })).toBe('inline');
    expect(sessionModelOptionsOf({ sessionModelOptions: 'tool' })).toBe('tool');
  });

  it('ignores the options while off, even invalid ones, and refuses an invalid one while on', () => {
    expect(createdModelOptionsOf({ reasoningEffort: 'loud' }, false)).toBeUndefined();
    expect(createdModelOptionsOf({}, true)).toEqual({});
    expect(() => createdModelOptionsOf({ reasoningEffort: 'loud' }, true))
      .toThrow('Invalid create_session input: reasoningEffort must be one of: none, minimal, low, medium, high, xhigh, max, ultra.');
    expect(() => createdModelOptionsOf({ contextTier: 'huge' }, true))
      .toThrow('Invalid create_session input: contextTier must be one of: default, long_context.');
  });
});

describe('the new chat\'s selection', () => {
  const inherited = { id: 'deep', config: { thinkingLevel: 'low' } };

  it('inherits the calling chat\'s selection with no model, and with options on for its own model', () => {
    expect(resolveCreatedModelSelection(undefined, undefined, 'claude', inherited, catalog)).toEqual(inherited);
    expect(resolveCreatedModelSelection('deep', undefined, 'claude', inherited, catalog)).toEqual({ id: 'deep' });
    expect(resolveCreatedModelSelection('deep', {}, 'claude', inherited, catalog)).toEqual(inherited);
  });

  it('writes a supported effort and tier as explicit choices, and drops their aliases', () => {
    const made = resolveCreatedModelSelection(undefined, { reasoningEffort: 'high', contextTier: 'long_context' }, 'claude',
      { id: 'deep', config: { reasoningEffort: 'low', contextTier: 'default' } }, catalog);
    expect(made).toEqual({ id: 'deep', config: {
      thinkingLevel: 'high', 'vscode.modelConfiguration.thinkingLevel.source': 'explicit',
      contextSize: 1000000, 'vscode.modelConfiguration.contextSize.source': 'explicit',
    } });
  });

  it('refuses in VS Code\'s words', () => {
    expect(() => resolveCreatedModelSelection(undefined, { reasoningEffort: 'high' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: reasoningEffort needs a model, but the new chat has no model to inherit. Pass `model` as well.');
    expect(() => resolveCreatedModelSelection('gone', { contextTier: 'default' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: can\'t check contextTier because model "gone" isn\'t among the available models right now. Retry, or pass `model` with an available model.');
    expect(() => resolveCreatedModelSelection('deep', { reasoningEffort: 'max' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: model "deep" doesn\'t support reasoningEffort "max". Use one of: low (Low), high (High), or omit reasoningEffort.');
    expect(() => resolveCreatedModelSelection('flat', { reasoningEffort: 'low' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: model "flat" has no reasoning effort option. Omit reasoningEffort.');
    expect(() => resolveCreatedModelSelection('locked', { reasoningEffort: 'low' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: reasoningEffort is locked for model "locked" and can\'t be changed. Omit reasoningEffort.');
    expect(() => resolveCreatedModelSelection('flat', { contextTier: 'long_context' }, 'claude', undefined, catalog))
      .toThrow('Invalid create_session input: model "flat" has a single context window, so contextTier doesn\'t apply. Omit contextTier, or pass a model with a larger context window.');
  });
});

describe('the options a model is listed with', () => {
  it('names the effort values and the tier, and nothing for a locked or plain model', () => {
    expect(describeCreateSessionModelOptions(deep)).toBe('reasoningEffort low|high, default high; contextTier long_context');
    expect(describeCreateSessionModelOptions(locked)).toBeUndefined();
    expect(describeCreateSessionModelOptions(flat)).toBeUndefined();
  });

  it('groups the catalog by agent, sorted by id', () => {
    expect(createSessionModelChoices([flat, deep, { id: 'a', name: 'A', provider: 'acp' }])).toBe([
      'acp:', '- a (A)', 'claude:', '- deep (Deep): reasoningEffort low|high, default high; contextTier long_context', '- flat (Flat)',
    ].join('\n'));
    expect(createSessionModelChoices([])).toBeUndefined();
  });
});
