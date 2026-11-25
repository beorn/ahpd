import type { Plugin } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.ts';

/** The two agents ahp-1-1-checks.mjs makes chats on: they call no model. */
export const name = 'ahp-1-1-check';
export const title = 'AHP 1.1.0 check';

const named = (provider: string, key: string) => {
  const base = echo({ path: process.env.HOME ?? '/', pace: 0 });
  return {
    ...base,
    provider,
    displayName: provider,
    schema: () => {
      const schema = base.schema() as { properties: Record<string, unknown> };
      return { ...schema, properties: { ...schema.properties, [key]: { type: 'string', title: key, enum: ['low', 'loud'], default: 'low', chatMutable: true } } };
    },
  };
};

export const apply: Plugin['apply'] = (host) => {
  host.registerAgent(named('echo-one', 'voice'));
  host.registerAgent(named('echo-two', 'tone'));
};
