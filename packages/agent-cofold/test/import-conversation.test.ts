import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { Message } from '@cofold/agents';
import type { ImportedConversation, Start } from '@ahpd/sdk';
import { cofoldAgent, turnsOf } from '../src/index.js';

/*
 * A conversation a client brought, written as one cofold ran.
 *
 * cofold keeps a conversation as messages and a run per turn, so the writer
 * makes both: the person's message, the reply's parts as one assistant
 * message, the completed calls' results as one tool message, and a run record
 * carrying the turn's usage, its ending and its span. Read back through
 * `turnsOf`, the store is the conversation it was made from, and a session
 * started under the same id continues it.
 */

const ID = '0a0a0a0a-1111-4111-8111-000000000032';
const SESSION = `ahp-session:/${ID}`;

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

/** A directory a store and a workspace can both live under. */
const place = (): { root: string; sweep: string; sweepUp: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-import-'));
  return { root: join(dir, 'store'), sweep: join(dir, 'work'), sweepUp: () => rmSync(dir, { recursive: true, force: true }) };
};

/** Import the conversation on an agent over `root`. */
const importing = async (agent: ReturnType<typeof cofoldAgent>, sweep: string): Promise<void> => {
  if (agent.importConversation === undefined) throw new Error('cofold cannot import a conversation');
  await agent.importConversation({
    uri: SESSION,
    workingDirectory: sweep,
    settings: {},
    turns,
    model: { id: 'anthropic/claude-opus-5' },
    title: 'Imported',
  });
};

/** The start the host hands a session it has just imported. */
const start = (agent: ReturnType<typeof cofoldAgent>, sweep: string): Start => ({
  uri: SESSION,
  chatUri: `ahp-chat:/${ID}`,
  settings: agent.defaults(),
  workingDirectory: sweep,
  clientToolTimeoutMs: 0,
  schema: () => agent.schema(),
  emit: () => {},
});

/** Waits for `check` to hold, turning the event loop, and fails after a few seconds. */
const until = async (check: () => boolean): Promise<void> => {
  const limit = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > limit) throw new Error('timed out waiting');
    await new Promise((done) => { setTimeout(done, 0); });
  }
};

it('reads back as the turns it was written from', async () => {
  const { root, sweep, sweepUp } = place();
  try {
    const agent = cofoldAgent({ store: root, adapter: createFakeModel({ script: [{ text: 'unused' }] }) });
    await importing(agent, sweep);

    const read = await turnsOf(createFileStore({ root }), ID);
    expect(read.map((turn) => [turn.id, turn.message.text, turn.state, turn.duration]))
      .toEqual([['turn-1', 'read a.ts', 'complete', 1500], ['turn-2', 'thanks', 'complete', 0]]);

    const parts = (read[0]?.responseParts ?? []) as Record<string, unknown>[];
    expect(parts.map((part) => part.kind)).toEqual(['markdown', 'toolCall', 'markdown', 'markdown']);
    expect(parts[0]).toMatchObject({ kind: 'markdown', content: 'Reading it.' });
    // The call is the one it was, from its part and its result.
    expect(parts[1]).toMatchObject({
      kind: 'toolCall',
      toolCall: {
        status: 'completed', toolName: 'read', toolInput: '{"path":"a.ts"}', success: true,
        content: [{ type: 'text', text: 'export {};' }],
      },
    });
    // A part cofold has no frame for is written as what it named.
    expect(parts[2]).toMatchObject({ kind: 'markdown', content: 'the file came from disk' });
    expect(parts[3]).toMatchObject({ kind: 'markdown', content: 'file:///tmp/report.txt' });

    expect(read[0]?.usage).toMatchObject({ inputTokens: 5, outputTokens: 7, model: 'anthropic/claude-opus-5' });
    expect(read[1]?.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    expect(read[1]?.responseParts).toEqual([expect.objectContaining({ kind: 'markdown', content: 'Any time.' })]);
  }
  finally {
    sweepUp();
  }
});

it('continues the conversation from the store it wrote', async () => {
  const { root, sweep, sweepUp } = place();
  try {
    const model = createFakeModel({ script: [{ text: 'continued' }] });
    const agent = cofoldAgent({ store: root, adapter: model });
    await importing(agent, sweep);
    // No `resume` and no `seed`: the store the import wrote is what the
    // session continues, as one cofold left on disk is continued.
    const session = await agent.create(start(agent, sweep));
    session.sendMessage('t1', 'carry on');
    await until(() => model.requests.length > 0);

    const request = model.requests.at(0);
    if (request === undefined) throw new Error('the turn asked no model');
    const said = (request.messages as Message[]).map((message) => ({
      role: message.role,
      // A tool's answer is a `toolResult` part; a text part is what a person
      // or the model said.
      text: message.parts
        .map((part) => part.type === 'text' ? part.text : part.type === 'toolResult' ? part.content : '')
        .join(''),
    }));
    expect(said).toContainEqual({ role: 'user', text: 'read a.ts' });
    expect(said).toContainEqual({ role: 'assistant', text: 'Reading it.' });
    expect(said).toContainEqual({ role: 'tool', text: 'export {};' });
    expect(said).toContainEqual({ role: 'user', text: 'thanks' });
    // The turn being run is the last thing the model is asked about.
    expect(said.at(-1)).toEqual({ role: 'user', text: 'carry on' });
    session.close();
  }
  finally {
    sweepUp();
  }
});
