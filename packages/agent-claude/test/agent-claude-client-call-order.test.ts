import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * When a client is asked to run a call.
 *
 * Claude's message reports a call before the CLI settles its permission, and a
 * client may answer as soon as it is asked. So the client is asked when the CLI
 * runs the call's handler, or when the person allows the call, and never by the
 * report. The client here answers each entry at once, which is the fastest one.
 */

type Handler = (input: Bag, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

const sdk = vi.hoisted(() => ({
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
  handlers: new Map<string, unknown>(),
  held: [] as Record<string, unknown>[],
  wake: undefined as (() => void) | undefined,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    for (const one of given.tools as { name: string; handler: unknown }[]) sdk.handlers.set(one.name, one.handler);
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    const held: Record<string, unknown>[] = [];
    sdk.held = held;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (held.length === 0) await new Promise<void>((resolve) => { sdk.wake = resolve; });
          yield held.shift() as Record<string, unknown>;
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');

const TOOL = 'mcp__client__probe__openFile';
const CALL = 'toolu_open';
const INPUT = { path: '/a.txt' };

const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise((r) => { setImmediate(r); }); };

const push = async (...frames: Record<string, unknown>[]): Promise<void> => {
  sdk.held.push(...frames);
  sdk.wake?.();
  await settle();
};

const report = (): Record<string, unknown> => ({
  type: 'assistant', parent_tool_use_id: null, uuid: 'u1',
  message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: CALL, name: TOOL, input: INPUT }] },
});

const streamed = (): Record<string, unknown>[] => [
  { type: 'message_start', message: { id: 'm1' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: CALL, name: TOOL, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(INPUT) } },
].map((event) => ({ type: 'stream_event', parent_tool_use_id: null, uuid: 'u0', event }));

const result = (text: string, isError = false): Record<string, unknown> => ({
  type: 'user', parent_tool_use_id: null, uuid: 'u2',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: CALL, content: text, is_error: isError }] },
});

const begun = async () => {
  const seen: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/order',
    chatUri: 'ahp-chat:/order',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-order-')),
    tools: [{ owner: 'probe', definition: { name: 'probe__openFile', description: 'Open', inputSchema: { type: 'object', properties: {} } } } as unknown as BoundTool],
    emit: (_channel, action) => {
      const said = action as Bag;
      seen.push(structuredClone(said));
      const request = said.request as Bag | undefined;
      // The client, which answers as soon as it is asked.
      if (said.type === 'session/inputNeededSet' && request?.kind === 'toolClientExecution') {
        session.completeToolCall?.(CALL, 'probe', { ok: true, text: 'opened', content: [{ type: 'text', text: 'opened' }] });
      }
    },
  });
  await settle();
  session.sendMessage('t1', 'go');
  await settle();
  const of = (type: string): Bag[] => seen.filter((one) => one.type === type && (one.toolCallId === undefined || one.toolCallId === CALL));
  return {
    session,
    of,
    /** How many times a client was asked to run the call. */
    entries: () => of('session/inputNeededSet').filter((one) => (one.request as Bag).kind === 'toolClientExecution').length,
    running: () => of('chat/toolCallReady').filter((one) => one.confirmed === 'not-needed').length,
    status: () => ((((session.chatState() as Bag).activeTurn as Bag).responseParts as Bag[])
      .map((part) => part.toolCall as Bag | undefined).find((call) => call?.toolCallId === CALL))?.status,
  };
};

const run = (): ReturnType<Handler> => (sdk.handlers.get('probe__openFile') as Handler)(INPUT, { _meta: { 'claudecode/toolUseId': CALL } });
const ask = (): Promise<unknown> => sdk.canUseTool?.(TOOL, INPUT, { toolUseID: CALL }) as Promise<unknown>;

beforeEach(() => { sdk.handlers.clear(); sdk.held = []; });

for (const [how, first] of [['a whole message', () => []], ['a streamed one', streamed]] as const) {
  it(`asks the client only once the person allowed a call ${how} reported`, async () => {
    const { session, entries, running, status } = await begun();
    await push(...first(), report());
    expect([entries(), running(), status()]).toEqual([0, 0, 'streaming']);
    const asked = ask();
    await settle();
    expect([entries(), status()]).toEqual([0, 'pending-confirmation']);
    session.confirm(CALL, true);
    await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
    expect((await run()).content[0]?.text).toBe('opened');
    expect([entries(), running()]).toEqual([1, 0]);
  });
}

it('asks the client when the handler runs, where nobody is asked', async () => {
  const { entries, running } = await begun();
  await push(report());
  expect([entries(), running()]).toEqual([0, 0]);
  expect((await run()).content[0]?.text).toBe('opened');
  expect([entries(), running()]).toEqual([1, 1]);
});

it('joins a handler that runs before the report', async () => {
  const { entries, running } = await begun();
  const answer = run();
  await settle();
  expect(entries()).toBe(0);
  await push(report());
  expect((await answer).content[0]?.text).toBe('opened');
  expect([entries(), running()]).toEqual([1, 1]);
});

it('joins a question put before the report', async () => {
  const { session, entries, running } = await begun();
  const asked = ask();
  await settle();
  await push(report());
  expect(entries()).toBe(0);
  session.confirm(CALL, true);
  await asked;
  expect((await run()).content[0]?.text).toBe('opened');
  expect([entries(), running()]).toEqual([1, 0]);
});

it('asks no client for a refused call', async () => {
  const { session, entries } = await begun();
  await push(report());
  const asked = ask();
  await settle();
  session.confirm(CALL, false);
  await expect(asked).resolves.toMatchObject({ behavior: 'deny' });
  await push(result('declined', true));
  expect(entries()).toBe(0);
});

it('never says a call running that ends with no handler, since a client would run it', async () => {
  const { entries, running, status } = await begun();
  await push(report(), result('a rule refused it', true));
  expect([entries(), running(), status()]).toEqual([0, 0, 'streaming']);
});

it('handles a message reported twice once', async () => {
  const { of, entries, running } = await begun();
  await push(report(), report());
  await run();
  await push(report());
  expect(of('chat/toolCallStart')).toHaveLength(1);
  expect([entries(), running()]).toEqual([1, 1]);
});

it('asks no client for a call whose turn was stopped', async () => {
  const { session, entries } = await begun();
  await push(report());
  session.abort();
  await settle();
  void run();
  await settle();
  expect(entries()).toBe(0);
});
