import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { ImportedConversation, Start } from '@ahpd/sdk';
import { piAgent } from '../src/agent.js';
import { loadPi } from '../src/pi.js';
import { fakePi, root, settled } from './fake-pi.js';

/*
 * A conversation a client brought, written as one pi ran.
 *
 * pi starts a session from a file it can open by id, so the writer makes one:
 * the message the turn had, kept under the entry the prompt names as its
 * parent, the prompt itself, an assistant message per reply, and a `toolResult`
 * message after each completed call. Read back through `replayEntries`, the
 * file is the conversation it was made from, and the session that follows
 * resumes it.
 */

const SESSION = 'ahp-session:/0a0a0a0a-1111-4111-8111-000000000030';
const WRITTEN = '0a0a0a0a-1111-4111-8111-000000000030';

/** The turns one conversation carries: a prompt with a run tool, and a thank you. */
const turns = [
  {
    id: 'turn-1', startedAt: '2020-01-01T00:00:00.000Z', duration: 1500, state: 'complete',
    message: { text: 'read a.ts', origin: { kind: 'user' } },
    responseParts: [
      { id: 'part-1', kind: 'markdown', content: 'Reading it.' },
      {
        kind: 'toolCall',
        toolCall: {
          status: 'completed', toolCallId: 'call-1', toolName: 'read', displayName: 'read',
          toolInput: '{"path":"a.ts"}', invocationMessage: 'a.ts', confirmed: 'not-needed',
          success: true, pastTenseMessage: 'a.ts', content: [{ type: 'text', text: 'export {};' }],
        },
      },
      { kind: 'systemNotification', content: 'the file came from disk' },
      { kind: 'contentRef', uri: 'file:///tmp/report.txt', sizeHint: 12 },
    ],
    usage: { inputTokens: 5, outputTokens: 7, model: 'anthropic/claude-opus-5' },
  },
  {
    id: 'turn-2', startedAt: '2020-01-01T00:00:02.000Z', state: 'complete',
    message: { text: 'thanks', origin: { kind: 'user' } },
    responseParts: [{ kind: 'markdown', content: 'Any time.' }],
    usage: undefined,
  },
] as unknown as ImportedConversation['turns'];

/** Import the conversation on a backend over `sessionDir`. */
const importing = async (sessionDir: string): Promise<ReturnType<typeof piAgent>> => {
  const agent = piAgent({ sessionDir }, [root], async () => []);
  if (agent.importConversation === undefined) throw new Error('pi cannot import a conversation');
  await agent.importConversation({
    uri: SESSION,
    workingDirectory: root,
    settings: {},
    turns,
    model: { id: 'anthropic/claude-opus-5' },
    title: 'Imported',
  });
  return agent;
};

/** The start the host hands a session it has just imported. */
const start = (): Start => ({
  uri: SESSION,
  chatUri: 'ahp-chat:/0a0a0a0a-1111-4111-8111-000000000030',
  settings: {},
  workingDirectory: root,
  clientToolTimeoutMs: 0,
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
});

it('writes the turns as pi\'s own entries, under the session\'s own id', async () => {
  const sessionDir = join(root, 'pi');
  await importing(sessionDir);
  const { SessionManager } = await loadPi();
  const file = SessionManager.findById(root, WRITTEN, sessionDir);
  if (file === undefined) throw new Error('no session file was written for the session id');
  const entries = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  expect(entries[0]).toMatchObject({ type: 'session', id: WRITTEN, cwd: root });
  // One chain: every entry after the header names the one before it.
  const body = entries.slice(1);
  expect(body.map((one) => one.parentId)).toEqual([null, ...body.slice(0, -1).map((one) => one.id)]);
  // The message the turn had is kept under the entry the prompt names as its parent.
  expect(body[0]).toMatchObject({ type: 'custom', customType: 'ahpd.message' });
  expect(body[1]).toMatchObject({
    type: 'message',
    id: 'turn-1',
    parentId: body[0]?.id,
    message: { role: 'user', content: 'read a.ts' },
  });
  // The call's result is the entry after the assistant message that asked for it.
  const answer = body.findIndex((one) => String(one.id).startsWith('turn-1:assistant'));
  expect(body[answer + 1]).toMatchObject({
    type: 'message',
    message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', isError: false },
  });
});

it('reads back as the turns it was written from', async () => {
  const sessionDir = join(root, 'pi');
  const agent = await importing(sessionDir);
  const read = await agent.transcript?.(WRITTEN);
  if (read === undefined) throw new Error('pi read no transcript');

  expect(read.map((turn) => [turn.id, turn.message.text, turn.state, turn.duration]))
    .toEqual([['turn-1', 'read a.ts', 'complete', 1500], ['turn-2', 'thanks', 'complete', 0]]);

  const parts = (read[0]?.responseParts ?? []) as Record<string, unknown>[];
  expect(parts.map((part) => part.kind)).toEqual(['markdown', 'toolCall', 'markdown', 'markdown']);
  expect(parts[0]).toMatchObject({ kind: 'markdown', content: 'Reading it.' });
  // The call is the one it was, from its `toolCall` and its result.
  expect(parts[1]).toMatchObject({
    kind: 'toolCall',
    toolCall: {
      status: 'completed', toolName: 'read', toolInput: '{"path":"a.ts"}', success: true,
      content: [{ type: 'text', text: 'export {};' }],
    },
  });
  // A part pi has no frame for is written as what it named.
  expect(parts[2]).toMatchObject({ kind: 'markdown', content: 'the file came from disk' });
  expect(parts[3]).toMatchObject({ kind: 'markdown', content: 'file:///tmp/report.txt' });

  expect(read[0]?.usage).toMatchObject({ inputTokens: 5, outputTokens: 7, model: 'anthropic/claude-opus-5' });
  expect(read[1]?.usage).toBeUndefined();
});

it('starts the session from the file it wrote', async () => {
  const sessionDir = join(root, 'pi');
  const pi = fakePi();
  const agent = piAgent({ sessionDir, open: pi.open }, [root], async () => []);
  if (agent.importConversation === undefined) throw new Error('pi cannot import a conversation');
  await agent.importConversation({
    uri: SESSION, workingDirectory: root, settings: {}, turns,
  });
  const session = await agent.create(start());
  session.sendMessage('t1', 'hello');
  for (let i = 0; i < 200 && pi.opens.length === 0; i++) await settled();

  const started = pi.opens.at(0);
  if (started === undefined) throw new Error('the session opened no pi');
  expect(started).toMatchObject({ cwd: root, resume: WRITTEN });
  // Resumed, not started over: pi is not handed a new session id.
  expect(started).not.toHaveProperty('id');
  session.close();
});
