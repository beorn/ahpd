/** When a chat's reasoning started and how long it took, on the actions a host says. */

import type { Bag } from '../types/common.js';
import { bag } from '../utils/values.js';

/** One run of reasoning under way in one chat. */
interface Run {
  turnId: string;
  partId: string;
  startedAt: string;
  began: number;
}

/** What ends a run in its own turn, beside a turn's own start and end. */
const ENDING = new Set(['chat/responsePart', 'chat/delta', 'chat/toolCallStart', 'chat/toolCallReady']);
const TURN_ENDS = new Set(['chat/turnStarted', 'chat/turnComplete', 'chat/turnCancelled', 'chat/error']);

/** The timer, as the host's one road for actions sees it. */
export interface ReasoningTimer {
  /** What is said for one action: the end of a run it ends, if any, then the action itself. */
  timed(channel: string, action: Bag): Bag[];
}

/**
 * Times each run of reasoning, for every agent the host runs.
 *
 * A reasoning part opened empty is a run: it is said with `startedAt`, and
 * what comes after the reasoning - another part, text, a call or the turn's
 * end - is preceded by a `chat/reasoning` with no text and the `duration`, as
 * VS Code's Copilot agent ends a run. A part that arrives whole took no time
 * anyone here measured, and a backend that says its own times is the producer
 * the protocol means, so neither is timed.
 * https://github.com/microsoft/vscode/blob/7e993177c9d9/src/vs/platform/agentHost/node/copilot/copilotReasoningTiming.ts#L107-L128
 * https://github.com/microsoft/agent-host-protocol/blob/v1.1.0/types/channels-chat/actions.ts#L703-L719
 */
export function reasoningTimer(clock: { now(): number; date(): Date } = { now: () => performance.now(), date: () => new Date() }): ReasoningTimer {
  const runs = new Map<string, Run>();

  const end = (channel: string): Bag[] => {
    const run = runs.get(channel);
    if (run === undefined) return [];
    runs.delete(channel);
    return [{
      type: 'chat/reasoning',
      turnId: run.turnId,
      partId: run.partId,
      content: '',
      startedAt: run.startedAt,
      duration: Math.max(0, Math.round(clock.now() - run.began)),
    }];
  };

  return {
    timed: (channel, action) => {
      const type = String(action.type ?? '');
      const turnId = String(action.turnId ?? '');
      const run = runs.get(channel);
      if (type === 'chat/reasoning') {
        if (run === undefined || run.turnId !== turnId) return [action];
        if (run.partId !== action.partId) return [...end(channel), action];
        if (action.duration !== undefined || action.startedAt !== undefined) runs.delete(channel);
        return [action];
      }
      const ends = run !== undefined && (TURN_ENDS.has(type) || (ENDING.has(type) && run.turnId === turnId)) ? end(channel) : [];
      if (type !== 'chat/responsePart') return [...ends, action];
      const part = bag(action.part);
      if (part.kind !== 'reasoning' || typeof part.id !== 'string' || part.startedAt !== undefined || (part.content ?? '') !== '')
        return [...ends, action];
      const startedAt = clock.date().toISOString();
      runs.set(channel, { turnId, partId: part.id, startedAt, began: clock.now() });
      return [...ends, { ...action, part: { ...part, startedAt } }];
    },
  };
}
