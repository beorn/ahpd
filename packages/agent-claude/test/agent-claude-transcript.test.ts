import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A Claude transcript read back as turns.
 *
 * The CLI writes a prompt, then one `assistant` frame per content block of each
 * API message, with a `user` frame of tool results between the rounds. Live,
 * all of that is one turn; read back, it is one turn too.
 */

type Entry = Record<string, unknown>;

const sdk = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  asked: [] as unknown[],
  /** Whether a read through a `sessionStore` throws. */
  storeFails: false,
  /**
   * The messages the SDK gives for transcript entries: from the last main-chain
   * `compact_boundary` on, and each entry's own `message`, which a system entry
   * has none of.
   */
  read: (entries: Record<string, unknown>[]): Record<string, unknown>[] => {
    const start = entries.findLastIndex((one) => one.type === 'system' && one.subtype === 'compact_boundary' && one.isSidechain !== true);
    return entries.slice(Math.max(start, 0))
      .filter((one) => ['user', 'assistant', 'system'].includes(String(one.type)) && typeof one.uuid === 'string' && one.isSidechain !== true)
      .map(({ type, uuid, timestamp, message, isCompactSummary }) => ({ type, uuid, timestamp, message, ...(isCompactSummary === true ? { isCompactSummary } : {}) }));
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSessionMessages: async (_id: string, options?: { sessionStore?: { load: (key: unknown) => Promise<Record<string, unknown>[] | null> } }) => {
    sdk.asked.push(options);
    if (options?.sessionStore === undefined) return sdk.messages;
    if (sdk.storeFails) throw new Error('the store read failed');
    return sdk.read(await options.sessionStore.load({ projectKey: 'project', sessionId: 'session' }) ?? []);
  },
}));

/** A Claude config folder of this file's own, where `written` puts the session's transcript. */
const CONFIG = mkdtempSync(join(tmpdir(), 'ahpd-transcript-'));
const configBefore = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = CONFIG;
afterAll(() => {
  if (configBefore === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = configBefore;
  rmSync(CONFIG, { recursive: true, force: true });
});

beforeEach(() => {
  sdk.asked = [];
  sdk.storeFails = false;
  rmSync(join(CONFIG, 'projects'), { recursive: true, force: true });
});

/** Writes `entries` as the transcript file of session `session`. */
function written(entries: Entry[]): void {
  const project = join(CONFIG, 'projects', '-work');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'session.jsonl'), entries.map((one) => `${JSON.stringify(one)}\n`).join(''));
}

const { turnsOf } = await import('../src/transcript.js');

const frame = (kind: 'user' | 'assistant', uuid: string, message: unknown, extra: Bag = {}): Record<string, unknown> => ({
  type: kind, uuid, timestamp: '2020-01-01T00:00:00.000Z', message, ...extra,
});

const prompt = (uuid: string, text: string): Record<string, unknown> => frame('user', uuid, { role: 'user', content: text });

const results = (uuid: string, id: string, text: string): Record<string, unknown> => frame('user', uuid, {
  role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }],
});

const said = (uuid: string, id: string, blocks: unknown[], outputTokens = 1): Record<string, unknown> => frame('assistant', uuid, {
  id, model: 'claude-opus-5', content: blocks, usage: { input_tokens: 10, output_tokens: outputTokens },
});

async function read(messages: Record<string, unknown>[]): Promise<Bag[]> {
  sdk.messages = messages;
  return await turnsOf('session') as unknown as Bag[];
}

/** A system entry as the CLI writes it, with its `subtype` and `content` at the top level and no `message`. */
const system = (uuid: string, subtype: string, extra: Bag = {}): Entry => ({ type: 'system', subtype, uuid, timestamp: '2020-01-01T00:00:00.000Z', ...extra });

/** A compaction as the CLI writes it: no `parentUuid`, and the entry before it as its `logicalParentUuid`. */
const boundary = (uuid: string, before: string): Entry => system(uuid, 'compact_boundary', {
  parentUuid: null, logicalParentUuid: before, content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 100 },
});

/** What the CLI writes after a compaction: the summary the model goes on from, which is no prompt. */
const summary = (uuid: string): Entry => frame('user', uuid, { role: 'user', content: 'This session is being continued from a previous conversation.' }, { isCompactSummary: true });

const notices = (turn: Bag | undefined): Bag[] => ((turn?.responseParts ?? []) as Bag[]).filter((one) => one.kind === 'systemNotification');
const texts = (turns: Bag[]): unknown[] => turns.flatMap((turn) => (turn.responseParts as Bag[]).filter((one) => one.kind === 'markdown').map((one) => one.content));

/*
 * The transcript is read once, with its system entries, and a compaction
 * boundary or a notification is drawn on its turn as a notification part,
 * other system entries dropped, as VS Code's replay keeps them. The SDK gives
 * a system entry with no `message`, so its subtype and text come from the
 * file.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L186-L208
 */
it('draws a compaction boundary and a notification on their turn, read with the system entries', async () => {
  const entries = [
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'text', text: 'Looking.' }]),
    system('s1', 'compact_boundary'),
    system('s2', 'notification', { content: 'Context was compacted.' }),
    system('s3', 'api_retry'),
    system('s4', 'api_error', { content: 'Overloaded' }),
  ];
  written(entries);
  const turns = await read(entries.map(({ subtype: _subtype, content: _content, ...kept }) => kept));

  expect(sdk.asked).toEqual([{ includeSystemMessages: true }]);
  expect(notices(turns[0])).toEqual([
    { kind: 'systemNotification', content: '[compact_boundary]' },
    { kind: 'systemNotification', content: 'Context was compacted.' },
  ]);
});

/*
 * The turns before a compaction.
 *
 * The SDK starts its read at the last boundary, and each segment before it is
 * read through a `sessionStore` holding the file's entries before its
 * boundary, so the session reads back every turn it ran.
 */
const compacted = (): Entry[] => [
  prompt('u1', 'look around'),
  said('a1', 'm1', [{ type: 'text', text: 'Looking.' }]),
  boundary('b1', 'a1'),
  summary('c1'),
  said('a2', 'm2', [{ type: 'text', text: 'Still looking.' }]),
  prompt('u2', 'next'),
  said('a3', 'm3', [{ type: 'text', text: 'Next.' }]),
];

it('reads a session with no compaction with one SDK call', async () => {
  const entries = [prompt('u1', 'first'), said('a1', 'm1', [{ type: 'text', text: 'One.' }])];
  written(entries);
  const turns = await read(sdk.read(entries));
  expect(sdk.asked).toEqual([{ includeSystemMessages: true }]);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['first']);
});

it('reads the turns before a compaction first, with the compaction drawn as a live turn draws it', async () => {
  written(compacted());
  const turns = await read(sdk.read(compacted()));
  expect(sdk.asked).toHaveLength(2);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['look around', 'next']);
  expect(texts(turns)).toEqual(['Looking.', 'Still looking.', 'Next.']);
  expect(notices(turns[0])).toEqual([{ kind: 'systemNotification', content: 'Conversation compacted' }]);
});

it('reads every turn of a session that compacted twice, in order', async () => {
  const entries = [
    ...compacted(),
    boundary('b2', 'a3'),
    summary('c2'),
    prompt('u3', 'last'),
    said('a4', 'm4', [{ type: 'text', text: 'Last.' }]),
  ];
  written(entries);
  const turns = await read(sdk.read(entries));
  expect(sdk.asked).toHaveLength(3);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['look around', 'next', 'last']);
  expect(notices(turns[0])).toHaveLength(1);
  expect(notices(turns[1])).toHaveLength(1);
});

it('draws a message two reads give once, at its first place', async () => {
  written(compacted());
  // A boundary's preserved segment: the SDK gives the reply before the boundary after it too.
  const [first, ...after] = sdk.read(compacted());
  const turns = await read([first!, said('a1', 'm1', [{ type: 'text', text: 'Looking.' }]), ...after]);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['look around', 'next']);
  expect(texts(turns)).toEqual(['Looking.', 'Still looking.', 'Next.']);
});

it('reads the turns from the last compaction when a read before it fails', async () => {
  written(compacted());
  sdk.storeFails = true;
  const turns = await read(sdk.read(compacted()));
  expect(texts(turns)).toEqual(['Still looking.', 'Next.']);
  expect(turns.at(-1)?.message).toMatchObject({ text: 'next' });
});

it('keeps the answers of a question asked before a compaction', async () => {
  const questions = [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A', description: 'The first' }, { label: 'B', description: 'The second' }], multiSelect: false }];
  const entries = [
    prompt('u1', 'ask me'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: { questions } }]),
    { ...results('r1', 'toolu_ask', 'User has answered.'), toolUseResult: { questions, answers: { 'Which one?': 'A' } } },
    said('a2', 'm2', [{ type: 'text', text: 'A it is.' }]),
    boundary('b1', 'a2'),
    summary('c1'),
    prompt('u2', 'next'),
  ];
  written(entries);
  const turns = await read(sdk.read(entries));
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['ask me', 'next']);
  expect((turns[0]?.responseParts as Bag[]).filter((one) => one.kind === 'inputRequest')).toHaveLength(1);
});

it('reads a prompt and every round that answered it as one turn', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    results('u2', 'toolu_1', 'a b c'),
    said('a2', 'm2', [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/tmp/a' } }]),
    results('u3', 'toolu_2', 'contents'),
    said('a3', 'm3', [{ type: 'text', text: 'All read.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ id: 'u1', message: { text: 'look around', origin: { kind: 'user' } } });
  const parts = turns[0]?.responseParts as Bag[];
  expect(parts.map((part) => part.kind)).toEqual(['toolCall', 'toolCall', 'markdown']);
  expect(parts[0]?.toolCall).toMatchObject({ toolCallId: 'toolu_1', status: 'completed', content: [{ type: 'text', text: 'a b c' }] });
  expect(parts[1]?.toolCall).toMatchObject({ toolCallId: 'toolu_2', status: 'completed', content: [{ type: 'text', text: 'contents' }] });
  expect(parts[2]).toMatchObject({ content: 'All read.' });
});

it('counts one message\'s usage once however many frames repeat it', async () => {
  const turns = await read([
    prompt('u1', 'think then answer'),
    said('a1', 'm1', [{ type: 'thinking', thinking: 'hmm' }], 4),
    said('a2', 'm1', [{ type: 'text', text: 'One.' }], 4),
    said('a3', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }], 4),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 4, inputTokens: 10, model: 'claude-opus-5' });
});

it('keeps an API error Claude Code wrote as the turn\'s content, and not its model as the model the turn ran on', async () => {
  const failed = frame('assistant', 'a2', {
    id: 'm2', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Upstream idle timeout exceeded' }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }, { isApiErrorMessage: true });
  const turns = await read([
    prompt('u1', 'split the file'),
    said('a1', 'm1', [{ type: 'text', text: 'Starting.' }]),
    failed,
  ]);
  const parts = turns[0]?.responseParts as Bag[];
  expect(parts.at(-1)).toMatchObject({ content: 'API Error: Upstream idle timeout exceeded' });
  expect(turns[0]?.usage).toMatchObject({ model: 'claude-opus-5' });
});

it('sums the usage of an exchange\'s distinct messages', async () => {
  const turns = await read([
    prompt('u1', 'two rounds'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }], 4),
    results('u2', 'toolu_1', 'ok'),
    said('a2', 'm2', [{ type: 'text', text: 'Done.' }], 6),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 10, inputTokens: 20 });
});

it('counts a frame with no message id on its own', async () => {
  const turns = await read([
    prompt('u1', 'no ids'),
    frame('assistant', 'a1', { content: [{ type: 'text', text: 'One.' }], usage: { output_tokens: 3 } }),
    frame('assistant', 'a2', { content: [{ type: 'text', text: 'Two.' }], usage: { output_tokens: 5 } }),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 8 });
});

it('opens an agent turn for a transcript that starts with the agent', async () => {
  const turns = await read([
    said('a1', 'm1', [{ type: 'text', text: 'Starting.' }]),
    said('a2', 'm2', [{ type: 'text', text: 'Still going.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ id: 'a1', message: { text: '', origin: { kind: 'agent' } } });
  expect((turns[0]?.responseParts as Bag[]).map((part) => part.content)).toEqual(['Starting.', 'Still going.']);
});

it('starts a new turn at the next prompt', async () => {
  const turns = await read([
    prompt('u1', 'first'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    prompt('u2', 'second'),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['first', 'second']);
});

it('reads a CLI echo between two rounds as no prompt', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    prompt('u2', '<local-command-stdout>Set model to claude-opus-5</local-command-stdout>'),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect((turns[0]?.responseParts as Bag[]).map((part) => part.content)).toEqual(['One.', 'Two.']);
});

it('reads every CLI echo marker as no prompt, in a string or a text block', async () => {
  const turns = await read([
    prompt('u1', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
    prompt('u2', '<command-message>model</command-message>'),
    prompt('u3', '<command-args>opus</command-args>'),
    prompt('u4', '<local-command-stderr>no</local-command-stderr>'),
    prompt('u5', '<local-command-caveat>Caveat: the messages below were generated by the user</local-command-caveat>'),
    frame('user', 'u6', { role: 'user', content: [{ type: 'text', text: '<local-command-stdout>ok</local-command-stdout>' }] }),
  ]);
  expect(turns).toHaveLength(0);
});

it('reads a prompt that only mentions a marker as a prompt', async () => {
  const turns = await read([prompt('u1', 'what does <command-name> mean?')]);
  expect(turns).toHaveLength(1);
});

it('reads a compact summary as no prompt', async () => {
  const turns = await read([
    prompt('u1', 'keep going'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    frame('user', 'u2', { role: 'user', content: 'This session is being continued from a previous conversation.' }, { isCompactSummary: true }),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.message).toMatchObject({ text: 'keep going' });
});

/*
 * A background task's end, which the CLI writes as a user frame of its own
 * origin. Read back it is a notice turn: the task's summary is its message,
 * and its origin says the system made it, as the live turn said.
 */
it('reads a task notification as a notice with the task\'s summary', async () => {
  const turns = await read([
    frame('user', 'u1', {
      role: 'user',
      content: '<task-notification>\n<task-id>b01fnggfk</task-id>\n<status>completed</status>\n<summary>Pause for 4 seconds</summary>\n</task-notification>',
    }, { origin: { kind: 'task-notification', producer: 'session-task' } }),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.message).toEqual({ text: 'Pause for 4 seconds', origin: { kind: 'systemNotification' } });
});

it('reads a task notification without a summary as its own text', async () => {
  const text = '<task-notification>\n<task-id>b01fnggfk</task-id>\n<status>completed</status>\n</task-notification>';
  const turns = await read([
    frame('user', 'u1', { role: 'user', content: text }, { origin: { kind: 'task-notification', producer: 'session-task' } }),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.message).toEqual({ text, origin: { kind: 'systemNotification' } });
});

/*
 * How long a past turn and its calls ran, off the frames.
 *
 * The CLI writes a time on every frame and the protocol has nowhere to put a
 * call's own, so the frames are what a duration is measured from: a call runs
 * from its `tool_use` to its `tool_result`, which its `_meta` says under VS
 * Code's key, and a turn lasts from the frame that opened it to the last one
 * that answered it.
 */

/** The same frame, at a time of its own. */
const when = (at: string, one: Record<string, unknown>): Record<string, unknown> => ({ ...one, timestamp: at });

it('measures a restored call between the frames that ran it', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'a b c')),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call._meta).toEqual({ toolKind: 'terminal', 'vscode.toolCallDurationMs': 4500 });
});

it('says no duration for a restored call with no result', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }])),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call._meta).toEqual({ toolKind: 'terminal' });
});

it('reads a call with no result back as one its turn ended around, and that turn as stopped', async () => {
  /*
   * A call the transcript holds no result for never finished. The reference
   * reads it back cancelled as skipped, which is how the protocol's reducer
   * holds a call still open when its turn ends, and reads the turn that held
   * it back cancelled.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L389-L417
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
   */
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    prompt('u2', 'and then'),
    said('a2', 'm2', [{ type: 'text', text: 'Done.' }]),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call).toMatchObject({ toolCallId: 'toolu_1', status: 'cancelled', reason: 'skipped', invocationMessage: expect.anything() });
  expect(call).not.toHaveProperty('success');
  expect(call).not.toHaveProperty('pastTenseMessage');
  expect(turns.map((turn) => turn.state)).toEqual(['cancelled', 'complete']);
});

it('gives a restored turn how long it took', async () => {
  const turns = await read([
    when('2020-01-01T00:00:00.000Z', prompt('u1', 'look around')),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'text', text: 'Looking.' }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'a b c')),
  ]);
  expect(turns[0]?.duration).toBe(9500);
});

it('gives a turn a single frame answered no time at all', async () => {
  const turns = await read([prompt('u1', 'hello')]);
  expect(turns[0]?.duration).toBe(0);
});

it('says a restored call\'s duration on VS Code\'s key alone', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'TodoWrite', input: { todos: [] } }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'ok')),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(Object.keys(call._meta as Bag)).toEqual(['vscode.toolCallDurationMs']);
});

/*
 * The CLI writes a frame as its block ends, so a thinking block ran from the
 * frame before it to its own. A frame with no time, or one that runs
 * backwards, says neither.
 */
it('says when a restored thinking block ran, and nothing where the log does not', async () => {
  const at = (seconds: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const thought = (uuid: string, timestamp: string | undefined) => ({ ...said(uuid, uuid, [{ type: 'thinking', thinking: uuid }]), timestamp });
  const turns = await read([
    { ...prompt('u1', 'think'), timestamp: at(0) },
    thought('a1', at(4)),
    { ...said('a2', 'a2', [{ type: 'text', text: 'slow words' }]), timestamp: at(30) },
    thought('a3', at(20)),
    thought('a4', undefined),
  ]);
  const thoughts = (turns[0]?.responseParts as Bag[]).filter((one) => one.kind === 'reasoning');
  expect(thoughts.map(({ startedAt, duration }) => ({ startedAt, duration }))).toEqual([
    { startedAt: at(0), duration: 4000 },
    { startedAt: undefined, duration: undefined },
    { startedAt: undefined, duration: undefined },
  ]);
});
