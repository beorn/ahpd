/**
 * The background tasks a backend reports, drawn as a chat's rows.
 *
 * One place builds every row, sends every action and answers every snapshot,
 * because the row is the protocol's and the backend's report is not: a second
 * builder is a second answer to what a client reads, and the two drift the day
 * one of them learns a field.
 */

import type { BackgroundShellWork, BackgroundSubagentWork, BackgroundWork } from '@microsoft/agent-host-protocol';
import type { Bag } from '../types/common.js';
import type { BackgroundTask, BackgroundTasks, MovableCalls, MoveToBackground } from '../types/background.js';
import type { HostContext } from './context.js';

/**
 * The flag a client stops work through.
 *
 * The reference host's own key, under which a row is a row with something to
 * stop. A task the backend cannot answer `stop` for carries none, and a client
 * that offers the action anyway is answered `{ stopped: false }` rather than
 * shown a button that does nothing.
 */
export const STOP_FLAG = 'vscode.stopBackgroundWork';

/**
 * The flag a client offers "Run in background" by, on a running call.
 *
 * Named for the method that acts on it, as `STOP_FLAG` is: present while a
 * provider's offer stands, and gone from the call once it completes, so a
 * finished call offers nothing.
 */
export const MOVE_FLAG = 'ahpd.backgroundToolCall';

/**
 * The row a call's work runs as in the background, on the call.
 *
 * Set once the work runs there, however it got there, and kept on the
 * completed call: a moved call answers its model at once, so this is how a
 * client goes from the call to the row that goes on after it.
 */
export const WORK_KEY = 'ahpd.backgroundWork';

/** One call a provider offered or moved: the move while the offer stands, the row once moved. */
interface Movable {
  move?: MoveToBackground;
  row?: string;
}

/** One task as the host holds it: what it says, and the row last sent for it. */
interface Record {
  task: BackgroundTask;
  row: BackgroundWork;
  /** The row as JSON, so a poll that says the same thing sends nothing. */
  said: string;
}

/** Where one chat's tasks are, by id. */
type Held = Map<string, Record>;

export interface Background {
  /** The seam a backend reports through, handed on `Start`. */
  heldTasks(): BackgroundTasks;
  /** The rows a chat's snapshot carries, or `undefined` when it has none. */
  rows(chat: string): BackgroundWork[] | undefined;
  /** Stop a task, answering whether live work was stopped. */
  stop(chat: string, id: string): Promise<boolean>;
  /** Drop every record of a session's chats, sending nothing. */
  forgetSession(uri: string): void;
  /** The seam a backend offers its running calls through, handed on `Start`. */
  heldMovable(): MovableCalls;
  /** Move one offered call, answering whether it moved. */
  move(chat: string, toolCallId: string): Promise<boolean>;
  /**
   * A backend's tool call action with the host's `_meta` keys on it.
   *
   * The backend writes its own `_meta` and knows nothing of these, so every
   * call action it sends passes through here: a start, ready or content
   * change keeps the keys the host already sent, and a completion carries the
   * call's last `_meta`, without the flag and with the row where it moved.
   */
  withMeta(chat: string, action: Bag): Bag;
}

/**
 * The row for one task.
 *
 * `_meta` is laid on only when there is something to stop: the flag is what a
 * client reads to decide whether to offer the action, so a row carrying it on
 * a task nothing can stop is a button that answers `{ stopped: false }`.
 */
export function rowOf(task: BackgroundTask): BackgroundWork {
  const base = {
    id: task.id,
    label: task.label,
    startedAt: task.startedAt,
    ...(task.stop === undefined ? {} : { _meta: { [STOP_FLAG]: true } }),
  };
  if (task.kind === 'shell') {
    const shell: BackgroundShellWork = {
      ...base,
      kind: 'shell' as BackgroundShellWork['kind'],
      command: task.command ?? '',
      ...(task.terminal === undefined ? {} : { terminal: task.terminal }),
    };
    return shell;
  }
  const subagent: BackgroundSubagentWork = {
    ...base,
    kind: 'subagent' as BackgroundSubagentWork['kind'],
    chat: task.chat ?? '',
  };
  return subagent;
}

export function createBackground(ctx: HostContext): Background {
  const { dispatch, log, subagents, byChat, sendSubagent } = ctx;

  /** Every chat's tasks, by id. */
  const records = new Map<string, Held>();

  /**
   * One action on a chat.
   *
   * A worker chat is reduced before it is sent, through the spawn area's own
   * `sendSubagent`: a worker has no `Session`, so what a subscriber reads of it
   * is the state this host folded from the backend's actions - and a row sent
   * round that is a row a late subscriber never sees.
   */
  const send = (at: string, action: Bag): void => {
    if (subagents.has(at)) sendSubagent(at, action);
    else dispatch(at, action);
  };

  const heldTasks = (): BackgroundTasks => ({
    set: (at, task) => {
      const held = records.get(at) ?? new Map<string, Record>();
      const row = rowOf(task);
      const said = JSON.stringify(row);
      const before = held.get(task.id);
      records.set(at, held);
      held.set(task.id, { task, row, said });
      // The row is what a client sees, so a report that builds the same one
      // is nothing to send - which is what a poll every second would otherwise
      // be: the same row, forty times a turn.
      if (before?.said === said) return;
      send(at, { type: 'chat/backgroundWorkSet', work: row });
    },
    remove: (at, id) => {
      const held = records.get(at);
      // An id the host never had is the protocol's no-op, and the backend
      // reports removals without tracking what the host kept.
      if (held === undefined || !held.delete(id)) return;
      if (held.size === 0) records.delete(at);
      send(at, { type: 'chat/backgroundWorkRemoved', id });
    },
  });

  const rows = (chat: string): BackgroundWork[] | undefined => {
    const held = records.get(chat);
    if (held === undefined || held.size === 0) return undefined;
    return [...held.values()].map((one) => one.row);
  };

  /**
   * Stop one task, through the backend that reported it.
   *
   * The record is the whole of the decision: a chat the host holds nothing
   * for, an id it never had and a task the backend gave no `stop` are the same
   * answer, `false`, because a client is not told which of the three it was.
   *
   * A `stop` that rejects fails the request with its own failure, as the
   * reference host lets its runtime's rejection through. The row stays where
   * it is either way: removing it is the backend's report to make, through
   * `remove`, when the work has actually ended - a host that took the row down
   * here would show a task gone while it ran.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3444
   */
  const stop = async (chat: string, id: string): Promise<boolean> => {
    const act = records.get(chat)?.get(id)?.task.stop;
    if (act === undefined) return false;
    return await act();
  };

  /** Every chat's offered and moved calls, by call id. */
  const movables = new Map<string, Map<string, Movable>>();

  const forgetSession = (uri: string): void => {
    const ofSession = (chat: string): boolean => byChat.get(chat)?.uri === uri || subagents.get(chat)?.session === uri;
    for (const chat of [...records.keys()]) {
      if (!ofSession(chat)) continue;
      records.delete(chat);
      log(`forgot the background work of ${chat}, whose session ${uri} is gone`);
    }
    for (const chat of [...movables.keys()]) {
      if (ofSession(chat)) movables.delete(chat);
    }
  };

  /**
   * A `_meta` with the host's keys as one call stands.
   *
   * The keys the host does not own are kept as they are: the reducer replaces
   * a call's whole `_meta`, so a key left out here is a key the call loses.
   * `ended` drops the flag, because a completed call can move nowhere.
   */
  const metaOf = (given: unknown, held: Movable | undefined, ended: boolean): Bag => {
    const meta: Bag = typeof given === 'object' && given !== null && !Array.isArray(given) ? { ...given as Bag } : {};
    delete meta[MOVE_FLAG];
    delete meta[WORK_KEY];
    if (!ended && held?.move !== undefined) meta[MOVE_FLAG] = true;
    if (held?.row !== undefined) meta[WORK_KEY] = held.row;
    return meta;
  };

  /** The running call `toolCallId` in the chat's running turn, with that turn's id. */
  const runningCall = (chat: string, toolCallId: string): { turnId: string; call: Bag } | undefined => {
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    if (turn === undefined || typeof turn.id !== 'string') return undefined;
    const parts = Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : [];
    const call = parts
      .map((part) => (part.kind === 'toolCall' ? part.toolCall as Bag | undefined : undefined))
      .find((one) => one?.toolCallId === toolCallId);
    return call?.status === 'running' ? { turnId: turn.id, call } : undefined;
  };

  /**
   * Say a running call's keys as they stand now.
   *
   * `chat/toolCallContentChanged` is the one action that changes a running
   * call's `_meta`, and it replaces the content too, so the call's content
   * goes with it unchanged. A call that is not running is left alone: its
   * keys go out on its completion, through `withMeta`.
   */
  const sayKeys = (chat: string, toolCallId: string): void => {
    const held = runningCall(chat, toolCallId);
    if (held === undefined) return;
    const meta = metaOf(held.call._meta, movables.get(chat)?.get(toolCallId), false);
    if (JSON.stringify(meta) === JSON.stringify(held.call._meta ?? {})) return;
    send(chat, {
      type: 'chat/toolCallContentChanged',
      turnId: held.turnId,
      toolCallId,
      content: Array.isArray(held.call.content) ? held.call.content : [],
      _meta: meta,
    });
  };

  const heldMovable = (): MovableCalls => ({
    offer: (chat, toolCallId, move) => {
      const held = movables.get(chat) ?? new Map<string, Movable>();
      movables.set(chat, held);
      held.set(toolCallId, { ...held.get(toolCallId), move });
      sayKeys(chat, toolCallId);
    },
    withdraw: (chat, toolCallId) => {
      const held = movables.get(chat)?.get(toolCallId);
      if (held?.move === undefined) return;
      delete held.move;
      sayKeys(chat, toolCallId);
    },
    moved: (chat, toolCallId, row) => {
      const held = movables.get(chat) ?? new Map<string, Movable>();
      movables.set(chat, held);
      held.set(toolCallId, { row });
      sayKeys(chat, toolCallId);
    },
  });

  /**
   * Move one call through the move its provider offered.
   *
   * No offer is the same answer as a move that did not happen, `false`, as a
   * stop with nothing to stop is: a client is not told which it was. A move
   * that throws fails the request with its own failure, as a stop's does.
   */
  const move = async (chat: string, toolCallId: string): Promise<boolean> => {
    const act = movables.get(chat)?.get(toolCallId)?.move;
    if (act === undefined) return false;
    return await act();
  };

  const withMeta = (chat: string, action: Bag): Bag => {
    const type = action.type;
    // A turn that ended took its calls with it, whichever way it ended.
    if (type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error') {
      movables.delete(chat);
      return action;
    }
    if (type !== 'chat/toolCallStart' && type !== 'chat/toolCallReady'
      && type !== 'chat/toolCallContentChanged' && type !== 'chat/toolCallComplete') return action;
    const toolCallId = typeof action.toolCallId === 'string' ? action.toolCallId : undefined;
    const ofChat = movables.get(chat);
    const held = toolCallId === undefined ? undefined : ofChat?.get(toolCallId);
    if (held === undefined || toolCallId === undefined || ofChat === undefined) return action;
    if (type !== 'chat/toolCallComplete') return { ...action, _meta: metaOf(action._meta, held, false) };
    /*
     * The call's last word. A completion that carries no `_meta` keeps the
     * one the call holds, which has the flag on it, so the host always sends
     * one: the call's own keys, the flag gone, the row where it moved.
     */
    const given = action._meta ?? runningCall(chat, toolCallId)?.call._meta;
    ofChat.delete(toolCallId);
    if (ofChat.size === 0) movables.delete(chat);
    return { ...action, _meta: metaOf(given, held, true) };
  };

  return { heldTasks, rows, stop, forgetSession, heldMovable, move, withMeta };
}
