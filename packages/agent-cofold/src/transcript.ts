/**
 * One cofold conversation, rebuilt as the AHP turns a client reads.
 *
 * `transcript(id)` is what makes a catalogue row openable and what a client
 * pages through before anything is started, so this is a read of the store and
 * nothing else: no model, no run and no session. cofold keeps a conversation as
 * `Message`s - a user message, then each assistant reply with its text, its
 * reasoning and its tool calls, and one tool message per result - while AHP
 * wants a turn per user message with every response part in the order it was
 * written. The translation lives here because it reads this backend's own
 * record, the way Claude's transcript reader reads Claude's.
 *
 * The run log is read beside the messages for the two facts a message does not
 * carry: how long a tool call ran, which its `tool.completed` event measured,
 * and the request a paused run is waiting on, which
 * `Store.requests` holds. Everything else comes from the messages themselves,
 * in the order cofold appended them, because a transcript that reorders a tool
 * call and its answer is a conversation read wrong.
 */

import { randomUUID } from 'node:crypto';
import { textOf } from '@cofold/agents';
import type { ContentPart, Message, RunEvent, RunStatus, Store, ToolCallPart, ToolResultPart, Usage } from '@cofold/agents';
import type { Agent, Bag, ImportedConversation } from '@ahpd/sdk';
import { bag, endedParts, str, withToolCallDuration } from '@ahpd/sdk';
import { compactionNotification, errorPart, imageRefOf } from './mapping.js';
import { describe, pastTenseOf, toolInputOf, toolMetaOf } from './tools.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: an agent
 * backend states its protocol shapes through `@ahpd/sdk`, and taking a second
 * dependency to repeat the same type would be a boundary this package does not
 * declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/** The pieces of a turn, taken from the contract rather than repeated here. */
type WireMessage = TranscriptTurn['message'];
type WireUsage = NonNullable<TranscriptTurn['usage']>;
type WireState = TranscriptTurn['state'];

/** What a run is waiting on, by the call it is about. */
interface Waiting {
  prompt?: string;
}

/** The error a turn ends with when its run was cut off, as VS Code's reader words it. */
const INTERRUPTED: Bag = {
  kind: 'error',
  error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
  resumable: true,
};

/**
 * When a part ran, from the times cofold 0.4.1 writes on each part; a
 * conversation written before has none, and its message's own time is the end
 * of the reply, which says neither.
 */
const timesOf = (part: ContentPart): { startedAt?: string; duration?: number } => {
  const { startedAt, endedAt } = part as { startedAt?: unknown; endedAt?: unknown };
  const start = Date.parse(str(startedAt) ?? '');
  if (!Number.isFinite(start)) return {};
  const duration = Date.parse(str(endedAt) ?? '') - start;
  return { startedAt: new Date(start).toISOString(), ...(Number.isFinite(duration) && duration >= 0 ? { duration } : {}) };
};

/**
 * cofold's token counts, in the protocol's spelling.
 *
 * `Turn.usage` is required and may be `undefined`, which is "not measured"
 * rather than "none", so a session with no run behind it answers `undefined`.
 * Cache writes and reasoning tokens have no protocol field; they ride `_meta`
 * exactly as the live mapping sends them, rather than being dropped.
 */
const usageOf = (usage: Usage): WireUsage => {
  const extra: Bag = {
    ...(usage.cacheWriteTokens !== undefined ? { 'ahpd.cacheWriteTokens': usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { 'ahpd.reasoningTokens': usage.reasoningTokens } : {}),
  };
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(Object.keys(extra).length > 0 ? { _meta: extra } : {}),
  };
};

/**
 * What a call asks the model to say, in one line.
 *
 * The live mapping draws this from the subject the call was proposed with
 * until an approval supplies a better sentence, so a transcript read back says
 * the same thing. The subject comes off the run's own `tool.proposed` events,
 * which is where the live turn read it.
 */
const invocationOf = (call: ToolCallPart, waiting: Waiting | undefined, subject: string | undefined): string =>
  waiting?.prompt ?? describe(call.name, subject);

/**
 * The call's input as the live row wrote it: the command a shell call runs,
 * and the JSON the model produced for every other call.
 */
const inputOf = (call: ToolCallPart, subject: string | undefined): string | undefined => {
  try {
    return toolInputOf(call.name, call.input, subject);
  } catch {
    // An argument shape JSON cannot write is still a fact; the raw string the
    // model produced is the closest honest form of it.
    return call.raw;
  }
};

/**
 * The part a tool call holds between its proposal and its result.
 *
 * A call with no result and no open request is `running` while its turn is
 * read, and the turn's end cancels it as the reducer does (`sealed`). A call a
 * paused run is waiting on is `pending-confirmation`, which is what a client
 * draws a question from.
 *
 * `durationMs` is how long the call ran, as cofold's completion measured it,
 * for a call that completed.
 */
const callPartOf = (
  call: ToolCallPart,
  durationMs: number | undefined,
  waiting: Waiting | undefined,
  subject: string | undefined,
): Bag => {
  const written = inputOf(call, subject);
  const meta: Bag = withToolCallDuration(toolMetaOf(call.name), durationMs) ?? {};
  const held: Bag = {
    toolCallId: call.callId,
    toolName: call.name,
    displayName: call.name,
    invocationMessage: invocationOf(call, waiting, subject),
    ...(written !== undefined ? { toolInput: written } : {}),
    /*
     * How long it ran rides the call's `_meta` under VS Code's key, as VS
     * Code's restored history carries it, and the kind goes with it: an
     * action's `_meta` replaces the whole bag, so a restored call that lost it
     * would draw as a generic tool.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1459
     */
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
  if (waiting !== undefined) {
    held.status = 'pending-confirmation';
    if (waiting.prompt !== undefined) held.confirmationTitle = waiting.prompt;
    return held;
  }
  held.status = 'running';
  held.confirmed = 'not-needed';
  return held;
};

/**
 * Close a call with the result cofold recorded.
 *
 * The mutation is deliberate: the part was pushed into the turn while the call
 * was still open, and a result arriving later moves the same object a
 * subscription already holds. `content` and `error` are where a client looks
 * for what happened, and a failed call keeps both.
 */
const completeCall = (held: Bag, result: ToolResultPart, pastTenseMessage: string | { markdown: string }): void => {
  held.status = 'completed';
  held.success = !result.isError;
  held.pastTenseMessage = pastTenseMessage;
  held.confirmed = held.confirmed ?? 'not-needed';
  if (result.content !== '') held.content = [{ type: 'text', text: result.content }];
  if (result.isError) held.error = { message: result.content === '' ? 'The tool failed' : result.content };
};

/** The turn being built, before it is pushed. */
interface Building {
  id: string;
  startedAt: string;
  message: WireMessage;
  parts: Bag[];
  /** The calls of this turn, by call id, so a result finds the part it closes. */
  calls: Map<string, Bag>;
  usage: WireUsage | undefined;
  state: WireState;
  duration: number | undefined;
  /** Whether this turn holds a compaction notice, which stands for the command's own output. */
  compacted: boolean;
  /** The id of the last message read into this turn, which is where it ended. */
  end: string;
}

/**
 * One run's events, or nothing when the run is gone.
 *
 * A rewind truncates the conversation while a client may be reading it: the
 * store rewrites the messages and then removes the run folders one by one, so
 * a run listed a moment ago can be gone by the time its events are asked for.
 * `not_found` is that run, and the read goes on without it. Every other store
 * error is a store that would not answer, which is not a run that is gone, and
 * it still ends the read.
 */
const eventsOf = async (store: Store, sessionId: string, runId: string): Promise<RunEvent[] | undefined> => {
  try {
    return await store.runs.listEvents({ sessionId, runId });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'not_found') return undefined;
    throw error;
  }
};

/**
 * One conversation as turns, in the order cofold wrote it.
 *
 * The store is the only input, so a session read here is the same conversation
 * a resumed session appends to rather than a second rendering of it.
 *
 * `ends` is given where each turn ended, by its id: the last message read into
 * it, which a fork copies through and a rewind keeps, as a live turn's run
 * records its last message. A paused run's turn has not ended and names none.
 *
 * `keptOf` answers the reference the host keeps for an image a reply carried
 * as bytes, by its message id and its place, where the reader has the host's
 * kept content to ask.
 */
export async function turnsOf(
  store: Store,
  sessionId: string,
  ends?: Map<string, string>,
  keptOf?: (key: string) => Bag | undefined,
): Promise<TranscriptTurn[]> {
  const messages = await store.sessions.listMessages({ sessionId });
  const runs = await store.runs.list({ sessionId });

  /** How long each completed call ran, by call id, gathered once from every run's events. */
  const durations = new Map<string, number>();
  /**
   * What each call acts on, by call id, from the `tool.proposed` that named it.
   *
   * The row is titled by this, exactly as the live turn titled it. A
   * `tool.proposed` that carries no `subject` names nothing, and its row is
   * titled by the tool's name.
   */
  const subject = new Map<string, string>();
  /** The request a paused run is waiting on, by the call it is about. */
  const waiting = new Map<string, Waiting>();
  /** The turns whose run a restart left paused, by their message's id. */
  const interrupted = new Set<string>();
  /**
   * The error part each failed run ended its turn with, by its message's id,
   * from the outcome its `run.finished` event keeps: the failure a client was
   * shown when the turn ended. It is not resumable: whether the store can be
   * cut back to the turn before is the live session's to say.
   */
  const failure = new Map<string, Bag>();
  /**
   * What each compaction had folded, by the summary message it wrote.
   *
   * The numbers live on the `context.compacted` event and nowhere in the
   * message, so a transcript that wants the sentence a live turn showed reads
   * them from the run log. A summary whose event is not here - one written by
   * a store that has been trimmed, or by a version that wrote no event - is
   * still a compaction and still says so, without the numbers.
   */
  const compacted = new Map<string, { before: number; after: number }>();
  /** What each turn cost, how it ended and how long it took, by its first message. */
  const usage = new Map<string, WireUsage>();
  const ending = new Map<string, WireState>();
  const duration = new Map<string, number>();
  /** The model reference each turn's run was told to use, by its first message. */
  const model = new Map<string, string>();

  for (const run of runs) {
    /*
     * The events are read before anything about the run is recorded, so a run
     * that a rewind removed mid-read leaves nothing behind: no usage, no
     * ending, no model, no duration, and none of the call durations, subjects
     * or compaction numbers its events carried.
     */
    const events = await eventsOf(store, sessionId, run.runId);
    if (events === undefined) continue;

    if (run.inputMessageId !== undefined) {
      usage.set(run.inputMessageId, {
        ...usageOf(run.usage),
        ...(run.model !== undefined ? { model: run.model } : {}),
      });
      if (run.model !== undefined) model.set(run.inputMessageId, run.model);
      /*
       * A run a restart left paused reads back as VS Code reads a turn still
       * running when its agent went away: interrupted, an error a client may
       * resume, which continues the run on its question.
       */
      ending.set(
        run.inputMessageId,
        run.status === 'failed' || run.status === 'awaiting' ? 'error' : run.status === 'cancelled' ? 'cancelled' : 'complete',
      );
      if (run.status === 'awaiting') interrupted.add(run.inputMessageId);
      const spent = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
      if (Number.isFinite(spent) && spent >= 0) duration.set(run.inputMessageId, spent);
    }

    for (const event of events) {
      if (event.type === 'tool.proposed' && event.subject !== undefined) subject.set(event.callId, event.subject);
      if (event.type === 'context.compacted') {
        compacted.set(event.messageId, { before: event.estimatedTokens, after: event.afterTokens });
      }
      if (event.type === 'tool.completed') durations.set(event.callId, event.durationMs);
      if (event.type === 'run.finished' && event.outcome.status === 'failed' && run.inputMessageId !== undefined) {
        failure.set(run.inputMessageId, errorPart(event.outcome.error.code, event.outcome.error.message));
      }
    }

    if (run.status !== 'awaiting' || run.pendingRequestId === undefined) continue;
    const request = await store.requests.get({ sessionId, runId: run.runId, requestId: run.pendingRequestId });
    if (request?.callId === undefined) continue;
    const payload = bag(request.payload);
    const prompt = str(payload.prompt);
    waiting.set(request.callId, {
      ...(prompt !== undefined ? { prompt } : {}),
    });
  }

  /** The turns read so far, sealed once the read is over, so a result read later still reaches its call. */
  const closed: Building[] = [];
  /**
   * Every call read, by its id, so a result closes its call in whatever turn
   * holds it, as VS Code's reader applies a completion to its call by id.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L570-L572
   */
  const everyCall = new Map<string, Bag>();
  let open: Building | undefined;

  /**
   * The turn as the contract wants it, so a half-built one never leaves.
   *
   * A paused run's turn ends with VS Code's error for a turn cut off, after its
   * parts, marked resumable, since a resume continues the run.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L499-L500
   */
  /*
   * A finished turn's calls end as the reducer ends them at the turn's end: a
   * call with no result is cancelled as `skipped`, as the live settle holds
   * it. A paused run's turn keeps the call it waits on, which a resume
   * continues.
   */
  const sealed = (turn: Building): TranscriptTurn => ({
    id: turn.id,
    startedAt: turn.startedAt,
    message: turn.message,
    responseParts: interrupted.has(turn.id)
      ? [...turn.parts, { ...INTERRUPTED }]
      : [...endedParts(turn.parts), ...(failure.has(turn.id) ? [{ ...failure.get(turn.id) }] : [])],
    usage: turn.usage,
    state: turn.state,
    ...(turn.duration !== undefined ? { duration: turn.duration } : {}),
  });

  /** A finished turn into the read, and where it ended into `ends`, unless its run is paused. */
  const close = (turn: Building): void => {
    closed.push(turn);
    if (!interrupted.has(turn.id)) ends?.set(turn.id, turn.end);
  };

  /**
   * Open a turn for a message; the previous one is finished by definition.
   *
   * A person's message reads back as the words they typed, its first text part:
   * the turn's message is built from that text and then the parts its
   * attachments were read into, which the live turn said apart from it.
   */
  const begin = (message: Message, origin: 'user' | 'agent'): void => {
    if (open !== undefined) close(open);
    const ran = model.get(message.id);
    const typed = message.parts.find((part) => part.type === 'text');
    open = {
      id: message.id,
      startedAt: message.createdAt,
      message: {
        text: origin === 'user' ? (typed?.type === 'text' ? typed.text : '') : textOf(message),
        origin: { kind: origin },
        // The protocol's `Message.model`, which a client reopens the session on.
        ...(ran !== undefined ? { model: { id: ran } } : {}),
      },
      parts: [],
      calls: new Map(),
      usage: usage.get(message.id),
      state: ending.get(message.id) ?? 'complete',
      duration: duration.get(message.id),
      compacted: false,
      end: message.id,
    };
  };

  /** The open turn, opened for this message when a reply has no question in front of it. */
  const ensure = (message: Message): void => {
    if (open === undefined) begin(message, 'agent');
  };

  for (const message of messages) {
    /*
     * A user message the person typed begins a turn, including one cofold
     * appended as a steer part-way through a run: it is a thing somebody said,
     * and the reply that follows it is its answer.
     */
    // A prompt command's expanded text belongs to the turn its typed line began.
    if (message.source === 'skill') {
      if (open !== undefined) open.end = message.id;
      continue;
    }
    if (message.role === 'user' && message.source !== 'system' && message.source !== 'summary' && message.source !== 'notice') {
      begin(message, 'user');
      continue;
    }

    /*
     * The harness's own words - a cancel marker, a compaction summary or what
     * a runtime command returned - are not the person's. They are kept as a
     * system notification rather than dropped, because a transcript that
     * reads as if nothing happened between two turns is a conversation read
     * wrong.
     *
     * A summary is the one of those whose text is not what a person reads: it
     * was written for the model, and the sentence that says a compaction
     * happened is the same one the live turn sent. Every message it stands for
     * stays a turn of its own - `summarizes` says what a request no longer
     * carries, not what the conversation has lost.
     *
     * A runtime command's notice is left out of a turn that already holds the
     * compaction's, as the live turn drew them.
     */
    if (message.role === 'user' || message.role === 'system') {
      // A harness message before anything was asked opens the turn, and the
      // notification below carries its words: the message text stays empty so
      // the same sentence is not in two places.
      if (open === undefined) begin({ ...message, parts: [] }, 'agent');
      const live = open;
      if (live === undefined) continue;
      live.end = message.id;
      if (message.source === 'notice' && live.compacted) continue;
      const summary = message.source === 'summary';
      const said = summary ? compactionNotification(compacted.get(message.id)) : textOf(message);
      if (summary) live.compacted = true;
      if (said !== '') live.parts.push({ kind: 'systemNotification', content: said });
      continue;
    }

    if (message.role === 'assistant') {
      ensure(message);
      const live = open;
      if (live === undefined) continue;
      live.end = message.id;
      for (const [index, part] of message.parts.entries()) {
        const id = `${message.id}:${index}`;
        if (part.type === 'text') {
          // Any text is a part, whitespace included, as it is live.
          if (part.text !== '') live.parts.push({ id, kind: 'markdown', content: part.text });
        } else if (part.type === 'reasoning') {
          live.parts.push({ id, kind: 'reasoning', content: part.text, ...timesOf(part) });
        } else if (part.type === 'toolCall') {
          const held = callPartOf(part, durations.get(part.callId), waiting.get(part.callId), subject.get(part.callId));
          // Registered before the part is pushed, so the result that follows
          // finds the same object the snapshot holds.
          live.calls.set(part.callId, held);
          everyCall.set(part.callId, held);
          live.parts.push({ kind: 'toolCall', toolCall: held });
        } else if (part.type === 'image') {
          /*
           * The spec's reference, as the live turn said it: the image's own
           * URL, or the reference the host answered for the bytes it keeps,
           * which a read is handed where the host keeps the chat's content.
           */
          const ref = imageRefOf(part, keptOf?.(id));
          if (ref !== undefined) live.parts.push({ kind: 'contentRef', ...ref });
        }
      }
      continue;
    }

    // A tool message is one result, and it closes the call it names.
    ensure(message);
    const live = open;
    if (live === undefined) continue;
    live.end = message.id;
    for (const part of message.parts) {
      if (part.type !== 'toolResult') continue;
      // A result closes its call in whatever turn holds it, and one with no
      // call is dropped, as VS Code's reader drops a completion it has no call for.
      const held = everyCall.get(part.callId);
      if (held === undefined) continue;
      // Worded as the live turn worded it.
      completeCall(held, part, pastTenseOf(String(held.toolName), String(held.displayName), subject.get(part.callId), !part.isError));
    }
  }

  if (open !== undefined) close(open);
  return closed.map(sealed);
}

/** One conversation a client imported, in the protocol's shape. */
type ImportedTurns = ImportedConversation['turns'];

/** What a written conversation is called where cofold keeps it. */
export interface ImportedHistoryAbout {
  /** The id a session that continues the conversation starts under. */
  sessionId: string;
  /** The agent the store records the conversation as run by. */
  agentId: string;
  /** The directory the conversation ran in, where the client named one. */
  workspace?: string;
  /** The model the conversation was held under, where no turn names one. */
  model?: string;
}

/** A number a bag carries, and nothing for anything else. */
const count = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * A tool result's blocks as cofold's one string a `toolResult` part carries.
 *
 * cofold keeps a result as text; a block with no frame of its own says what it
 * refers to, as the live mapping keeps a resource's reference.
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
 * A call's input as cofold keeps it: the arguments the model gave, and the
 * string exactly as it was given.
 *
 * The protocol carries the input as the string the tool was handed. cofold
 * keeps the parsed arguments beside the raw string; a string that parses as a
 * JSON object is both, and anything else is kept as it came.
 */
const callInputOf = (given: unknown): { input: unknown; raw: string } => {
  if (typeof given !== 'string') return { input: given, raw: given === undefined ? '' : JSON.stringify(given) ?? '' };
  try {
    const parsed: unknown = JSON.parse(given);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return { input: parsed, raw: given };
  }
  catch { /* not JSON */ }
  return { input: given, raw: given };
};

/** A turn's usage as cofold's run record keeps it, and the model it ran on. */
const usageIn = (given: Bag | undefined, fallback: string | undefined): { usage: Usage; model?: string } => {
  const meta = bag(given?._meta);
  const input = count(given?.inputTokens);
  const output = count(given?.outputTokens);
  const read = count(given?.cacheReadTokens);
  const wrote = count(meta['ahpd.cacheWriteTokens']);
  const thought = count(meta['ahpd.reasoningTokens']);
  const model = str(given?.model) ?? fallback;
  return {
    usage: {
      // The two counts cofold requires are the ones it would count itself:
      // nothing was measured where the import named none.
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      ...(read === undefined ? {} : { cacheReadTokens: read }),
      ...(wrote === undefined ? {} : { cacheWriteTokens: wrote }),
      ...(thought === undefined ? {} : { reasoningTokens: thought }),
    },
    ...(model === undefined ? {} : { model }),
  };
};

/** The error a turn's last error part carried, as a failed run records it. */
const failureOf = (parts: readonly Bag[]): { code: string; message: string } | undefined => {
  const failed = parts.filter((part) => part.kind === 'error').at(-1);
  if (failed === undefined) return undefined;
  const error = bag(failed.error);
  return { code: str(error.errorType) ?? 'error', message: str(error.message) ?? 'The turn failed.' };
};

/**
 * Write a conversation's turns into a cofold store.
 *
 * A turn becomes a user message, the reply's parts as one assistant message,
 * and the completed calls' results as one tool message, which is the order
 * `turnsOf` reads. The run beside them is where the turn's usage, its ending
 * and its span are kept, so the conversation reads back as the store reads any
 * other: a session started under the same id continues it.
 *
 * The run is written after its messages, because a store advances a message's
 * run to the time it was appended, and the turn's own span is its started time
 * plus its duration. The writer claim is taken first and given back after, so
 * the session is free when the import is done.
 *
 * @returns nothing; the store is the record.
 */
export async function writeImportedHistory(
  store: Store,
  turns: ImportedTurns,
  about: ImportedHistoryAbout,
): Promise<void> {
  await store.sessions.create({
    sessionId: about.sessionId,
    agentId: about.agentId,
    ...(about.workspace === undefined ? {} : { workspace: about.workspace }),
  });
  let clock = 0;
  for (const turn of turns) {
    const parsed = Date.parse(turn.startedAt ?? '');
    const start = Number.isFinite(parsed) ? parsed : clock;
    const duration = typeof turn.duration === 'number' && Number.isFinite(turn.duration) && turn.duration > 0
      ? turn.duration
      : 0;
    const startedAt = new Date(start).toISOString();
    const endedAt = new Date(start + duration).toISOString();
    clock = start + duration;

    const message = bag(turn.message);
    const user: Message = {
      id: turn.id,
      role: 'user',
      source: 'input',
      parts: [{ type: 'text', text: String(message.text ?? '') }],
      createdAt: startedAt,
    };
    const answer: ContentPart[] = [];
    const shown: ContentPart[] = [];
    const results: ToolResultPart[] = [];
    const read = (turn.responseParts ?? []).map((part) => bag(part));

    for (const part of read) {
      switch (str(part.kind)) {
        case 'markdown':
          answer.push({ type: 'text', text: String(part.content ?? '') });
          break;
        case 'reasoning':
          answer.push({ type: 'reasoning', text: String(part.content ?? '') });
          break;
        case 'toolCall': {
          const call = bag(part.toolCall);
          const given = callInputOf(call.toolInput);
          const callId = String(call.toolCallId ?? '');
          const name = String(call.toolName ?? '');
          answer.push({ type: 'toolCall', callId, name, input: given.input, raw: given.raw });
          if (call.status === 'completed') {
            results.push({
              type: 'toolResult',
              callId,
              name,
              content: resultTextOf(call.content),
              isError: call.success !== true || call.error !== undefined,
            });
          }
          break;
        }
        /*
         * A notification, a reference and a question have no part of cofold's
         * own; they are written as the text they say, as Claude's writer writes
         * a part Claude has no frame for. They are not the model's words, so
         * they go in a message of their own with source `notice`, which the
         * store keeps and a request leaves out.
         */
        case 'systemNotification': {
          const said = typeof part.content === 'string' ? part.content : str(bag(part.content).markdown);
          shown.push({ type: 'text', text: said ?? '' });
          break;
        }
        case 'contentRef':
          shown.push({ type: 'text', text: String(part.uri ?? '') });
          break;
        case 'inputRequest': {
          const request = bag(part.request);
          shown.push({ type: 'text', text: str(request.message) ?? String(request.id ?? '') });
          break;
        }
        // The ending state carries the error, which the failed run records.
        case 'error':
        default:
          break;
      }
    }

    const written: Message[] = [user];
    if (answer.length > 0) {
      written.push({ id: `${turn.id}:answer`, role: 'assistant', source: 'model', parts: answer, createdAt: startedAt });
    }
    if (shown.length > 0) {
      written.push({ id: `${turn.id}:shown`, role: 'assistant', source: 'notice', parts: shown, createdAt: startedAt });
    }
    if (results.length > 0) {
      written.push({ id: `${turn.id}:results`, role: 'tool', source: 'tool', parts: results, createdAt: startedAt });
    }

    const { usage, model } = usageIn(turn.usage === undefined ? undefined : bag(turn.usage), about.model);
    const status: RunStatus = turn.state === 'error' ? 'failed' : turn.state === 'cancelled' ? 'cancelled' : 'completed';
    const failure = failureOf(read);
    const runId = randomUUID();
    const run = {
      runId,
      sessionId: about.sessionId,
      agentId: about.agentId,
      status,
      createdAt: startedAt,
      updatedAt: endedAt,
      usage,
      steps: 0,
      denials: [],
      // The span a cut keeps the turn by, and the turn's own id: `turnsOf`
      // reads the turn back from the message the run was opened on.
      inputMessageId: user.id,
      lastMessageId: written.at(-1)?.id ?? user.id,
      ...(model === undefined ? {} : { model }),
    };

    if (!await store.sessions.claimWriter({ sessionId: about.sessionId, runId })) {
      throw new Error(`cofold will not write the imported conversation: ${about.sessionId} is held by another run`);
    }
    try {
      await store.sessions.appendMessages({ sessionId: about.sessionId, runId, messages: written });
      await store.runs.create(run);
      if (failure !== undefined) {
        await store.runs.appendEvent({
          seq: 1,
          runId,
          sessionId: about.sessionId,
          agentId: about.agentId,
          at: endedAt,
          type: 'run.finished',
          outcome: { status: 'failed', error: failure, usage, steps: 0 },
        });
      }
    }
    finally {
      await store.sessions.releaseWriter({ sessionId: about.sessionId, runId });
    }
  }
}
