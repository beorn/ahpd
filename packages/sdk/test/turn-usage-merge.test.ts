import { expect, it } from 'vitest';
import { mergeLogicalTurnUsage } from '../src/sessions/catalog.js';

it('joins the connectors two runs of one turn named, each once', () => {
  const merged = mergeLogicalTurnUsage(
    { inputTokens: 5, _meta: { 'ahpd.connectors': ['work'] } },
    { inputTokens: 7, _meta: { 'ahpd.connectors': ['personal', 'work'] } },
  );
  expect((merged?._meta as Record<string, unknown>)['ahpd.connectors']).toEqual(['work', 'personal']);
});

it('names no connectors where neither run named one', () => {
  const merged = mergeLogicalTurnUsage({ inputTokens: 5, _meta: {} }, { inputTokens: 7, _meta: { 'ahpd.cacheWriteTokens': 1 } });
  expect(merged?._meta).not.toHaveProperty('ahpd.connectors');
});
