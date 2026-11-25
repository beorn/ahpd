import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * Two steering messages sent before the CLI reads either.
 *
 * The CLI reads its prompts when it asks for them, so the mock hands one over
 * only when the case pulls. AHP 1.1.0 keeps steering messages in one list, and
 * each must be said removed as the CLI reads it, or the list keeps an entry
 * for a message that was read long ago.
 */
const sdk = vi.hoisted(() => {
  const state = {
    /** What the CLI read, in order. */
    read: [] as Bag[],
    /** Ask the CLI to read one more prompt. */
    pull: undefined as (() => Promise<void>) | undefined,
    reset() { state.read = []; state.pull = undefined; },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => [],
  query: (given: { prompt: AsyncGenerator<Bag> }) => {
    sdk.pull = async () => {
      const next = await given.prompt.next();
      if (!next.done) sdk.read.push(next.value);
    };
    let closed = false;
    let wake: (() => void) | undefined;
    return {
      async *[Symbol.asyncIterator]() {
        while (!closed) await new Promise<void>((resolve) => { wake = resolve; });
      },
      interrupt: async () => {},
      cancelAsyncMessage: async () => true,
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { closed = true; wake?.(); },
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

it('says each steering message removed as the CLI reads it, when two wait at once', async () => {
  sdk.reset();
  const chat: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/steering-list',
    chatUri: 'ahp-chat:/steering-list',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-steering-list-')),
    emit: (channel, action) => { if (channel === 'chat') chat.push(structuredClone(action) as Bag); },
  });
  await settle();
  session.sendMessage('9975eb65-d506-4ab4-a8e6-6b318497c4e1', 'first');
  await settle();
  await sdk.pull?.();
  await settle();

  expect(session.sendSteeringMessage?.({ id: 's1', text: 'look here' })).toBe(true);
  expect(session.sendSteeringMessage?.({ id: 's2', text: 'and there' })).toBe(true);
  await settle();
  const removed = (): unknown[] => chat
    .filter((one) => one.type === 'chat/pendingMessageRemoved' && one.kind === 'steering')
    .map((one) => one.id);
  expect(removed()).toEqual([]);

  await sdk.pull?.();
  await settle();
  expect(removed()).toEqual(['s1']);
  await sdk.pull?.();
  await settle();
  expect(removed()).toEqual(['s1', 's2']);
  await session.close();
});
