/**
 * Where an automation's runs go: AHP 1.2.0's `target`.
 *
 * `target` is the field. A definition that names none and says the older
 * `_meta.ahpd.session: 'pinned'` continues its session, as `previousSession`
 * does, so a definition saved before `target` keeps working.
 * https://github.com/microsoft/agent-host-protocol/blob/e36b0a20/types/channels-automation/state.ts#L289-L420
 */
import { TARGET_KINDS } from '../types/automations-next.js';
import type { AutomationTarget } from '../types/automations-next.js';

const recordOf = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** Where a definition's runs go. */
export const targetOf = (definition: unknown): AutomationTarget => {
  const held = recordOf(definition);
  const target = recordOf(held['target']);
  if (target['kind'] === 'chat' && typeof target['chat'] === 'string')
    return { kind: 'chat', chat: target['chat'], session: typeof target['session'] === 'string' ? target['session'] : '' };
  if (target['kind'] === 'previousSession') return { kind: 'previousSession' };
  if (target['kind'] === 'newSession') return { kind: 'newSession' };
  return recordOf(recordOf(held['_meta'])['ahpd'])['session'] === 'pinned' ? { kind: 'previousSession' } : { kind: 'newSession' };
};

/** Whether a run of this target continues a session rather than making one. */
export const continues = (target: AutomationTarget): boolean => target.kind !== 'newSession';

/** The automations whose chat target is `chat`, each with the target it takes once the chat is in `to`. */
export const retargeted = (automations: readonly { resource: string; definition: unknown }[], to: string, chat: string): { resource: string; target: AutomationTarget }[] =>
  automations.flatMap((one) => {
    const target = targetOf(one.definition);
    return target.kind === 'chat' && target.chat === chat && target.session !== to
      ? [{ resource: one.resource, target: { kind: 'chat' as const, session: to, chat } }]
      : [];
  });

/** What is wrong with a definition's `target`, in VS Code's words, or nothing. */
export const targetProblem = (definition: unknown): string | undefined => {
  const raw = recordOf(definition)['target'];
  if (raw === undefined) return undefined;
  const kind = recordOf(raw)['kind'];
  if (typeof kind !== 'string' || !(TARGET_KINDS as readonly string[]).includes(kind)) return `Automation target is not available: ${String(kind)}`;
  if (kind === 'chat' && typeof recordOf(raw)['chat'] !== 'string') return 'An automation chat target needs a chat.';
  return undefined;
};
