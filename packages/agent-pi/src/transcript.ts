/**
 * A session's turns as the turns a client reads, and the writer that makes a
 * conversation a client brought into one of pi's own files.
 *
 * Two records give the turns, sealed the same way: the one kept as this process
 * watched each turn run, the same parts array the live turn streamed into, and
 * the one `replay.ts` rebuilds from pi's own file for a session this process
 * did not watch, through the same `mapEvent`.
 */

import { writeFileSync } from 'node:fs';
import type { Agent, Bag, ImportedConversation } from '@ahpd/sdk';
import { bag, str } from '@ahpd/sdk';
import { loadPi } from './pi.js';
import { INTERRUPTED, MESSAGE_ENTRY } from './types.js';
import type { WatchedSession } from './types.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: a backend
 * states its protocol shapes through `@ahpd/sdk`, and a second dependency to
 * repeat the same type would be a boundary this package does not declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/**
 * One session's watched or rebuilt turns, in the order they ran.
 *
 * A turn with no ending is one still running when the record is read, and it
 * reads back interrupted, as pi's own file reads such a turn back: in error,
 * after its parts, VS Code's resumable `executionInterrupted`.
 */
export function turnsOf(session: Pick<WatchedSession, 'turns'>): TranscriptTurn[] {
  return session.turns.map((turn) => ({
    id: turn.turnId,
    startedAt: turn.startedAt,
    /*
     * The message as the turn had it, its attachments and model included. A
     * turn this bridge began is the person's unless somebody said otherwise,
     * and the transcript states that: the protocol requires an origin, and a
     * typed read cannot carry a `Bag` that has none.
     */
    message: {
      ...turn.message,
      text: String(turn.message.text ?? ''),
      origin: turn.message.origin ?? { kind: 'user' },
    },
    responseParts: turn.state === undefined
      ? [...turn.parts, { kind: 'error', error: { ...INTERRUPTED }, resumable: true }]
      : turn.parts,
    usage: turn.usage,
    state: turn.state ?? 'error',
    ...(turn.duration === undefined ? {} : { duration: turn.duration }),
  })) as TranscriptTurn[];
}

/** One conversation a client imported, in the protocol's shape. */
type ImportedTurns = ImportedConversation['turns'];

/** What a written conversation is called where pi keeps it. */
export interface ImportedHistoryAbout {
  /** The id pi's own lookup finds the file by. */
  sessionId: string;
  /** The directory the conversation ran in, which pi writes into the header. */
  folder: string;
  /** Where pi keeps its sessions; its own default when left out. */
  sessionDir?: string;
  /** The model the conversation was held under, where the client named one. */
  model?: string;
}

/** A number a bag carries, and nothing for anything else. */
const count = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The words of a string or a markdown object, as pi's one string field takes them. */
const wordsOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const markdown = bag(value).markdown;
  return typeof markdown === 'string' ? markdown : '';
};

/**
 * A tool result's blocks as the one string a `toolResult` message carries.
 *
 * pi keeps a result as text and images; the blocks with no pi frame say what
 * they refer to, as Claude's writer says it for the parts Claude has none for.
 */
const resultTextOf = (content: unknown): string => {
  if (!Array.isArray(content)) return '';
  return content
    .map((raw): string => {
      const block = bag(raw);
      switch (str(block.type)) {
        case 'text': return str(block.text) ?? '';
        case 'embeddedResource': return str(block.data) ?? '';
        case 'resource': return str(block.uri) ?? '';
        case 'fileEdit': {
          const after = bag(block.after);
          const before = bag(block.before);
          return str(after.uri) ?? str(before.uri) ?? '';
        }
        case 'terminal': {
          const result = bag(block.result);
          return [str(block.title) ?? '', str(result.preview) ?? ''].filter((one) => one !== '').join('\n');
        }
        case 'subagent': return str(block.title) ?? str(block.description) ?? '';
        default: return '';
      }
    })
    .filter((one) => one !== '')
    .join('\n');
};

/**
 * A call's input as pi's `arguments` object carries it.
 *
 * The protocol gives a call its input as the string the tool was given; pi
 * keeps it as the object the model produced. A string that parses as an object
 * is that object. A tool whose string is the one field it takes is rebuilt as
 * it, and anything else is kept under `input`.
 */
const argumentsOf = (toolName: string, given: unknown): Bag => {
  if (typeof given === 'string') {
    try {
      const parsed: unknown = JSON.parse(given);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Bag;
    }
    catch { /* not JSON */ }
    if (toolName === 'bash' || toolName === 'powershell') return { command: given };
    if (toolName === 'grep' || toolName === 'glob' || toolName === 'find') return { pattern: given };
    return { input: given };
  }
  return typeof given === 'object' && given !== null && !Array.isArray(given) ? given as Bag : {};
};

/** A model reference as pi's assistant message carries it, provider and id apart. */
const modelIn = (model: string | undefined): { provider: string; model: string } | undefined => {
  if (model === undefined) return undefined;
  const slash = model.indexOf('/');
  if (slash > 0 && slash < model.length - 1) return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
  // A reference with no provider is still the model it names; the provider is
  // spelled out so pi's own `provider/model` reading can carry it back.
  return { provider: 'imported', model };
};

/** A turn's usage as pi's assistant message carries it, and the model it ran on. */
const usageIn = (given: Bag | undefined, fallback: string | undefined): { usage: Bag; model?: string } | undefined => {
  if (given === undefined) return undefined;
  const input = count(given.inputTokens);
  const output = count(given.outputTokens);
  const cacheRead = count(given.cacheReadTokens);
  const cacheWrite = count(bag(given._meta)['ahpd.cacheWriteTokens']);
  const model = str(given.model) ?? fallback;
  return {
    /*
     * `totalTokens` is what pi's own context estimate reads, so it is written
     * even where the import named no count for one side. The counts are the
     * ones the import gave, and not a zero for a number it never reported.
     */
    usage: {
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
      totalTokens: (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    },
    ...(model === undefined ? {} : { model }),
  };
};

/**
 * The entries pi's file holds for one conversation, from turns a client
 * imported.
 *
 * The shape is the one `replayEntries` reads: a `custom` entry keeping the
 * message as the turn had it, immediately before the `user` message that opens
 * the turn, each assistant message's blocks by their index, and a `toolResult`
 * message after each completed call. The turn's last entry carries its start
 * plus its duration, which is how `replayEntries` measures a turn.
 *
 * A part pi has no frame for is written as text. The turn's state is written
 * as the stop reason of its last assistant message, and its usage there too.
 */
export function framesFor(turns: ImportedTurns, about: { model?: string }): Bag[] {
  const frames: Bag[] = [];
  let parentId: string | null = null;
  let clock = 0;
  const push = (entry: Bag): void => {
    frames.push(entry);
    parentId = String(entry.id);
  };
  const at = (ms: number): string => new Date(ms).toISOString();

  for (const turn of turns) {
    const parsed = Date.parse(turn.startedAt ?? '');
    const start = Number.isFinite(parsed) ? parsed : clock;
    const duration = typeof turn.duration === 'number' && Number.isFinite(turn.duration) && turn.duration > 0
      ? turn.duration
      : 0;
    const end = start + duration;
    const writtenAt = at(start);
    const message = bag(turn.message);
    const usage = usageIn(turn.usage === undefined ? undefined : bag(turn.usage), about.model);
    const model = modelIn(usage?.model);

    /*
     * The message as the turn had it, kept under the entry the prompt's own
     * message names as its parent, as `replay.ts` reads it back.
     */
    push({
      type: 'custom',
      customType: MESSAGE_ENTRY,
      data: { message },
      id: `${turn.id}:kept`,
      parentId,
      timestamp: writtenAt,
    });
    push({
      type: 'message',
      id: turn.id,
      parentId,
      timestamp: writtenAt,
      message: { role: 'user', content: String(message.text ?? ''), timestamp: start },
    });

    let content: Bag[] = [];
    let assistants = 0;
    let last: Bag | undefined;
    let failure: string | undefined;

    /** The assistant message for the blocks written since the last one. */
    const flush = (): void => {
      if (content.length === 0) return;
      const toolCalls = content.some((block) => block.type === 'toolCall');
      last = {
        type: 'message',
        id: `${turn.id}:assistant:${assistants += 1}`,
        parentId,
        timestamp: writtenAt,
        message: {
          role: 'assistant',
          content,
          usage: {},
          stopReason: toolCalls ? 'toolUse' : 'stop',
          timestamp: start,
        },
      };
      push(last);
      content = [];
    };

    for (const raw of turn.responseParts ?? []) {
      const part = bag(raw);
      switch (str(part.kind)) {
        case 'markdown':
          content.push({ type: 'text', text: String(part.content ?? '') });
          break;
        case 'reasoning':
          content.push({ type: 'thinking', thinking: String(part.content ?? '') });
          break;
        case 'toolCall': {
          const call = bag(part.toolCall);
          const callId = String(call.toolCallId ?? '');
          const name = String(call.toolName ?? '');
          content.push({ type: 'toolCall', id: callId, name, arguments: argumentsOf(name, call.toolInput) });
          if (call.status === 'completed') {
            flush();
            const text = resultTextOf(call.content);
            push({
              type: 'message',
              id: `${turn.id}:tool:${assistants}:${callId}`,
              parentId,
              timestamp: writtenAt,
              message: {
                role: 'toolResult',
                toolCallId: callId,
                toolName: name,
                content: text === '' ? [] : [{ type: 'text', text }],
                isError: call.success !== true || call.error !== undefined,
                timestamp: start,
              },
            });
          }
          break;
        }
        /*
         * A notification, a reference and a question have no block of pi's
         * own; they are written as the text they say, as Claude's writer
         * writes a part Claude has no frame for.
         */
        case 'systemNotification':
          content.push({ type: 'text', text: wordsOf(part.content) });
          break;
        case 'contentRef':
          content.push({ type: 'text', text: String(part.uri ?? '') });
          break;
        case 'inputRequest': {
          const request = bag(part.request);
          content.push({ type: 'text', text: str(request.message) ?? String(request.id ?? '') });
          break;
        }
        // The turning state carries the error, and pi's stop reason is where it goes.
        case 'error':
          failure = str(bag(part.error).message) ?? failure;
          break;
        default:
          break;
      }
    }
    flush();
    if (last === undefined) {
      last = {
        type: 'message',
        id: `${turn.id}:assistant:${assistants += 1}`,
        parentId,
        timestamp: writtenAt,
        message: {
          role: 'assistant',
          content: [],
          usage: {},
          stopReason: 'stop',
          timestamp: start,
        },
      };
      push(last);
    }
    const answer = bag(last.message);
    answer.usage = usage?.usage ?? {};
    if (model !== undefined) {
      answer.provider = model.provider;
      answer.model = model.model;
    }
    answer.stopReason = turn.state === 'error' ? 'error' : turn.state === 'cancelled' ? 'aborted' : 'stop';
    if (turn.state === 'error') answer.errorMessage = failure ?? 'pi did not answer';
    // The last entry of the turn is where it ended, which is its duration.
    const final = frames[frames.length - 1];
    if (final !== undefined) final.timestamp = at(end);
    clock = end;
  }
  return frames;
}

/**
 * Write a conversation's turns as one of pi's own session files.
 *
 * The file is where pi's own lookup reads it: under `sessionDir` when one was
 * given, and pi's default store otherwise, named by the timestamp `create`
 * chose and the session's id. A session started from it resumes the
 * conversation as pi wrote it.
 *
 * @returns the file written.
 */
export async function writeImportedHistory(
  turns: ImportedTurns,
  about: ImportedHistoryAbout,
): Promise<string> {
  const { SessionManager } = await loadPi();
  const manager = SessionManager.create(about.folder, about.sessionDir, { id: about.sessionId });
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error('pi named no session file');
  const header = manager.getHeader();
  if (header === null) throw new Error('pi made no session header');
  const entries = [header, ...framesFor(turns, { ...(about.model === undefined ? {} : { model: about.model }) })];
  writeFileSync(file, entries.map((one) => `${JSON.stringify(one)}\n`).join(''));
  return file;
}
