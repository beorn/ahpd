import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { subagentChatUri } from '@ahpd/sdk';
import type { BackgroundTask, Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * A Claude call that waits on its task, moved to the background.
 *
 * `task_started` names a foreground `Bash` or subagent with
 * `is_backgrounded: false`, and the session offers the call through the host's
 * movable-calls seam. The move is the SDK's own `backgroundTasks` with the one
 * call's id, and the session says the row the call runs as before the call
 * completes, so the host writes it on the completion.
 */

/**
 * The SDK's stream as a queue a test pushes frames into.
 *
 * Pulled one frame at a time, so a test can push a run of frames, let the
 * session settle and read what it said before the next run.
 */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    canUseTool: undefined as undefined | ((name: string, input: Bag, about?: Bag) => Promise<unknown>),
    /** The hooks the last query was built with. */
    hooks: undefined as undefined | Record<string, { matcher?: string; hooks: ((input: Bag, id: unknown, about: Bag) => Promise<unknown>)[] }[]>,
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    /** The task ids `stopTask` was asked to stop, in order. */
    stopped: [] as string[],
    /** The tool_use ids `backgroundTasks` was asked to move, in order. */
    moved: [] as string[],
    /** What `backgroundTasks` answers: a boolean, or a throw. */
    answer: true as boolean | 'throws',
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); state.stopped = []; state.moved = []; state.answer = true; },
    /** Queue frames for the current session to read. */
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    /** One feed's next frame, once one is queued. */
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    // The CLI reads every prompt it is handed, which is when a turn's prompt leaves the queue.
    if (typeof prompt === 'object' && prompt !== null && Symbol.asyncIterator in prompt) {
      void (async () => { for await (const _ of prompt as AsyncIterable<unknown>) { /* read */ } })();
    }
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    sdk.hooks = options.hooks as typeof sdk.hooks;
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
      stopTask: async (id: string) => { sdk.stopped.push(id); },
      backgroundTasks: async (id?: string) => {
        sdk.moved.push(id ?? '');
        if (sdk.answer === 'throws') throw new Error('background tasks are disabled');
        return sdk.answer;
      },
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
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

/** What a test reads back: the lead chat's actions and each worker chat's. */
interface Opened {
  main: Bag[];
  workers: Map<string, Bag[]>;
  /** The URI the seam handed back for each worker, once it opened one. */
  handed: Map<string, string>;
  /** What the session reported to the host's movable-calls seam. */
  moves: {
    offered: Map<string, () => Promise<boolean>>;
    moved: { chat: string; toolCallId: string; row: string }[];
  };
  /** What the session reported to the host's background-task seam. */
  tasks: {
    set: { chat: string; task: BackgroundTask }[];
    remove: { chat: string; id: string }[];
  };
  session: Awaited<ReturnType<typeof createSession>>;
}

/**
 * A session on the fake feed, with a host seam that opens worker chats.
 *
 * `seam` off is a host that hands the session no way to open a worker's chat,
 * which is the case a background subagent cannot be listed in. `turn` is the
 * turn the frames a case feeds answer, running from the start.
 */
async function open(seam = true, turn = true, over: Record<string, unknown> = {}): Promise<Opened> {
  sdk.reset();
  const main: Bag[] = [];
  const workers = new Map<string, Bag[]>();
  const handed = new Map<string, string>();
  const tasks: Opened['tasks'] = { set: [], remove: [] };
  const moves: Opened['moves'] = { offered: new Map(), moved: [] };
  const session = 'ahp-session:/bg';
  const subagent = (toolCallId: string, _request: SubagentRequest): SubagentChat => {
    // The name the host really gives, so a listed entry is checked against the
    // chat the worker is handed rather than against a string of this test's.
    const uri = subagentChatUri(session, toolCallId);
    const held: Bag[] = [];
    workers.set(toolCallId, held);
    handed.set(toolCallId, uri);
    return {
      uri,
      turnId: `wturn-${toolCallId}`,
      emit: (action) => { held.push(action as Bag); },
      end: () => {},
    };
  };
  const running = createSession({
    uri: session,
    chatUri: 'ahp-chat:/bg',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-bg-')),
    emit: (_channel, action) => { main.push(action as Bag); },
    // The host's name for a worker's chat before it opens, beside the seam
    // that opens it, as a host hands both.
    ...(seam ? { subagent, subagentChatOf: (toolCallId: string) => subagentChatUri(session, toolCallId) } : {}),
    backgroundTasks: {
      set: (chat, task) => { tasks.set.push({ chat, task }); },
      remove: (chat, id) => { tasks.remove.push({ chat, id }); },
    },
    movableCalls: {
      offer: (chat, toolCallId, move) => { moves.offered.set(`${chat} ${toolCallId}`, move); },
      withdraw: (chat, toolCallId) => { moves.offered.delete(`${chat} ${toolCallId}`); },
      moved: (chat, toolCallId, row) => { moves.moved.push({ chat, toolCallId, row }); },
    },
    ...over,
  });
  await settle();
  if (turn) {
    running.sendMessage('t1', 'go');
    await settle();
  }
  return { main, workers, handed, tasks, moves, session: running };
}

/** Everything one chat was reported as running, in order. */
const said = (tasks: Opened['tasks'], chat: string): BackgroundTask[] => tasks.set
  .filter((one) => one.chat === chat)
  .map((one) => one.task);

/** One background shell's call, its `task_started` and its level. */
const shellFrames = (id: string, command: string): Record<string, unknown>[] => [
  {
    type: 'assistant',
    message: {
      id: `msg-${id}`,
      content: [{ type: 'tool_use', id: `toolu-${id}`, name: 'Bash', input: { command, run_in_background: true } }],
    },
  },
  {
    type: 'system',
    subtype: 'task_started',
    task_id: id,
    tool_use_id: `toolu-${id}`,
    description: command,
    task_type: 'local_bash',
  },
];

/** The level naming exactly these tasks, which is the whole live set. */
const level = (...tasks: Bag[]): Record<string, unknown> => ({
  type: 'system', subtype: 'background_tasks_changed', tasks,
});

/** A call that waits on its task: its tool use and its `task_started`. */
const waited = (id: string, name: 'Bash' | 'Agent', type: 'local_bash' | 'local_agent', backgrounded = false): Record<string, unknown>[] => [
  {
    type: 'assistant',
    message: {
      id: `msg-${id}`,
      content: [{ type: 'tool_use', id: `toolu-${id}`, name, input: name === 'Bash' ? { command: 'sleep 9' } : { description: 'look', prompt: 'look around', subagent_type: 'general-purpose' } }],
    },
  },
  { type: 'system', subtype: 'task_started', task_id: id, tool_use_id: `toolu-${id}`, description: 'work', task_type: type, is_backgrounded: backgrounded },
];

/** The call's result, with the structured output the SDK puts beside it. */
const answered = (id: string, structured?: Record<string, unknown>): Record<string, unknown> => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu-${id}`, content: 'running in the background' }] },
  ...(structured === undefined ? {} : { tool_use_result: structured }),
});

const CHAT = 'ahp-chat:/bg';

it('offers a foreground Bash, and moves it through the SDK with its own id', async () => {
  const { moves } = await open();
  sdk.push(...waited('b1', 'Bash', 'local_bash'));
  await settle();
  const move = moves.offered.get(`${CHAT} toolu-b1`);
  expect(move).toBeDefined();
  expect(await move?.()).toBe(true);
  expect(sdk.moved).toEqual(['toolu-b1']);
  expect(moves.moved).toEqual([{ chat: CHAT, toolCallId: 'toolu-b1', row: 'shell:b1' }]);
});

it('offers a foreground subagent, whose row is its own', async () => {
  const { moves } = await open();
  sdk.push(...waited('a1', 'Agent', 'local_agent'));
  await settle();
  expect(await moves.offered.get(`${CHAT} toolu-a1`)?.()).toBe(true);
  expect(moves.moved.at(-1)).toEqual({ chat: CHAT, toolCallId: 'toolu-a1', row: 'subagent:a1' });
});

it('offers nothing a task started in the background, nor a task of another kind', async () => {
  const { moves } = await open();
  sdk.push(...waited('b2', 'Bash', 'local_bash', true));
  sdk.push({ type: 'system', subtype: 'task_started', task_id: 'm1', tool_use_id: 'toolu-m1', task_type: 'mcp_task', is_backgrounded: false });
  await settle();
  expect([...moves.offered.keys()]).toEqual([]);
});

it('answers false and says no row where the SDK moved nothing, or refused', async () => {
  const { moves } = await open();
  sdk.push(...waited('b3', 'Bash', 'local_bash'));
  await settle();
  const move = moves.offered.get(`${CHAT} toolu-b3`);
  sdk.answer = false;
  expect(await move?.()).toBe(false);
  sdk.answer = 'throws';
  expect(await move?.()).toBe(false);
  expect(moves.moved).toEqual([]);
});

it('says the row before the call completes, from the result\'s background task', async () => {
  const { moves, main } = await open();
  sdk.push(...waited('b4', 'Bash', 'local_bash'));
  await settle();
  sdk.push(answered('b4', { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b4', backgroundedByUser: true }));
  await settle();
  expect(moves.moved).toEqual([{ chat: CHAT, toolCallId: 'toolu-b4', row: 'shell:b4' }]);
  // Said before the completion, which is where the host writes it.
  const completed = main.findIndex((one) => one.type === 'chat/toolCallComplete' && one.toolCallId === 'toolu-b4');
  expect(completed).toBeGreaterThan(-1);
});

it('says the row when the SDK reports the move itself', async () => {
  const { moves } = await open();
  sdk.push(...waited('b5', 'Bash', 'local_bash'));
  sdk.push({ type: 'system', subtype: 'task_updated', task_id: 'b5', patch: { is_backgrounded: true } });
  await settle();
  expect(moves.moved).toEqual([{ chat: CHAT, toolCallId: 'toolu-b5', row: 'shell:b5' }]);
});

it('offers nothing in a session whose env turns background tasks off', async () => {
  const { moves } = await open(true, true, { preset: { env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } } });
  sdk.push(...waited('b6', 'Bash', 'local_bash'));
  await settle();
  expect([...moves.offered.keys()]).toEqual([]);
});
