import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { Turn } from '@microsoft/agent-host-protocol';

/*
 * A conversation a client brought, written as one this CLI ran.
 *
 * The CLI seeds nothing: a session resumes the file the session itself would
 * have written, so the writer is the reader's own frames - a `user` frame per
 * turn, `assistant` frames per part, and a `user` frame of `tool_result` blocks
 * after each completed call. Read back by `turnsOf`, the file is the
 * conversation it was made from.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionInfo: async (id: string) => {
    sdk.asked.push(id);
    return transcriptOf(id) === undefined ? undefined : { sessionId: id };
  },
  deleteSession: async (id: string) => {
    const file = transcriptOf(id);
    if (file !== undefined) rmSync(file, { force: true });
  },
  // The SDK's read of a session's entries, from the file the CLI wrote.
  getSessionMessages: async (id: string) => {
    const file = transcriptOf(id);
    if (file === undefined) return [];
    return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((one) => typeof one.uuid === 'string' && one.isSidechain !== true
        && (one.type === 'user' || one.type === 'assistant' || one.type === 'system'))
      .map((one) => ({
        type: one.type,
        uuid: one.uuid,
        timestamp: one.timestamp,
        ...(one.message === undefined ? {} : { message: one.message }),
      }));
  },
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      [Symbol.asyncDispose]: async () => {},
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
      interrupt: async () => {},
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

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], asked: [] as string[] }));

/** Where the config folder keeps a session's transcript, or nothing when it has none. */
function transcriptOf(id: string): string | undefined {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? '', 'projects');
  if (process.env.CLAUDE_CONFIG_DIR === undefined || !existsSync(projects)) return undefined;
  for (const project of readdirSync(projects)) {
    const file = join(projects, project, `${id}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

const { claude } = await import('../src/claude.js');
const { turnsOf } = await import('../src/transcript.js');

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-claude-import-')));
const FOLDER = join(home, 'work');
mkdirSync(FOLDER, { recursive: true });
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setImmediate(done); });
};

const SESSION = 'ahp-session:/0a0a0a0a-1111-4111-8111-000000000010';
const WRITTEN = '0a0a0a0a-1111-4111-8111-000000000010';

/** The turns one conversation carries: a prompt with a run tool, and a thank you. */
const turns = [
  {
    id: 'turn-1', startedAt: '2020-01-01T00:00:00.000Z', duration: 1500, state: 'complete',
    message: { text: 'run the tests', origin: { kind: 'user' } },
    responseParts: [
      { id: 'part-1', kind: 'markdown', content: 'Running them.' },
      {
        kind: 'toolCall',
        toolCall: {
          status: 'completed', toolCallId: 'call-1', toolName: 'Bash', displayName: 'Bash',
          toolInput: 'npm test', invocationMessage: 'Running code', confirmed: 'not-needed',
          success: true, pastTenseMessage: 'Ran code', content: [{ type: 'text', text: 'all pass' }],
        },
      },
      { kind: 'systemNotification', content: 'the tests took a moment' },
      { kind: 'contentRef', uri: 'file:///tmp/report.txt', sizeHint: 12 },
    ],
    usage: { inputTokens: 5, outputTokens: 7, model: 'claude-sonnet-4' },
  },
  {
    id: 'turn-2', startedAt: '2020-01-01T00:00:02.000Z', state: 'complete',
    message: { text: 'thanks', origin: { kind: 'user' } },
    responseParts: [{ id: 'part-2', kind: 'markdown', content: 'Any time.' }],
    usage: undefined,
  },
] as unknown as Turn[];

const importing = async (): Promise<Turn[]> => {
  const agent = claude({ paths: [FOLDER] });
  if (agent.importConversation === undefined) throw new Error('claude cannot import a conversation');
  await agent.importConversation({
    uri: SESSION,
    workingDirectory: FOLDER,
    settings: {},
    turns,
    model: { id: 'claude-sonnet-4' },
    title: 'Imported',
  });
  return turns;
};

it('writes the turns as the CLI\'s frames, under the session\'s own id', async () => {
  await importing();
  const file = transcriptOf(WRITTEN);
  if (file === undefined) throw new Error('no transcript was written for the session id');
  const entries = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(entries[0]).toMatchObject({ type: 'user', sessionId: WRITTEN, message: { role: 'user', content: 'run the tests' } });
  // One chain: every frame names the one before it.
  expect(entries.map((one) => one.parentUuid)).toEqual([null, ...entries.slice(0, -1).map((one) => one.uuid)]);
  // The call's result is the frame after its `tool_use`.
  const use = entries.findIndex((one) => String(JSON.stringify(one.message)).includes('"tool_use"'));
  expect(entries[use + 1]).toMatchObject({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', is_error: false }] },
  });
});

it('reads back as the turns it was written from', async () => {
  await importing();
  const read = await turnsOf(WRITTEN);

  expect(read).toHaveLength(2);
  expect(read.map((one) => one.message.text)).toEqual(['run the tests', 'thanks']);
  expect(read.map((one) => one.state)).toEqual(['complete', 'complete']);
  // The duration is the turn's own, from the frames it was built from.
  expect(read.map((one) => one.duration)).toEqual([1500, 0]);

  const first = read[0];
  const parts = first?.responseParts ?? [];
  expect(parts.map((one) => one.kind)).toEqual(['markdown', 'toolCall', 'systemNotification', 'markdown']);
  expect(parts[0]).toMatchObject({ kind: 'markdown', content: 'Running them.' });
  // The call is the one it was, from its `tool_use` and its result.
  expect(parts[1]).toMatchObject({
    kind: 'toolCall',
    toolCall: {
      status: 'completed', toolName: 'Bash', toolInput: 'npm test', success: true,
      content: [{ type: 'text', text: 'all pass' }],
    },
  });
  expect(parts[2]).toMatchObject({ kind: 'systemNotification', content: 'the tests took a moment' });
  // A part Claude has no frame for is written as what it named.
  expect(parts[3]).toMatchObject({ kind: 'markdown', content: 'file:///tmp/report.txt' });

  expect(first?.usage).toMatchObject({ inputTokens: 5, outputTokens: 7, model: 'claude-sonnet-4' });
  expect(read[1]?.responseParts).toEqual([expect.objectContaining({ kind: 'markdown', content: 'Any time.' })]);
});

it('resumes the session from the file it wrote', async () => {
  await importing();
  sdk.asked = [];
  sdk.options = [];
  const agent = claude({ paths: [FOLDER] });
  if (agent.importConversation === undefined) throw new Error('claude cannot import a conversation');
  // The same agent wrote it; this one is the one that starts the session, so
  // the file is what makes the resume rather than anything held in memory.
  await agent.importConversation({ uri: SESSION, workingDirectory: FOLDER, settings: {}, turns });
  const session = agent.create({
    uri: SESSION,
    chatUri: 'ahp-chat:/imported',
    workingDirectory: FOLDER,
    settings: {},
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  });
  session.sendMessage('t1', 'hello');
  await settle();

  const started = sdk.options.at(0);
  if (started === undefined) throw new Error('the session started no CLI');
  expect(sdk.asked).toContain(WRITTEN);
  expect(started).toMatchObject({ resume: WRITTEN });
  // Resumed, not started over: the SDK is handed no new session id.
  expect(started).not.toHaveProperty('sessionId');
});
