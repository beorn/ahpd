/**
 * The one-time trigger: an automation that runs once, at `runAt`.
 *
 * The checks and their words are VS Code's, so a client that got a refusal
 * there gets the same one here. Once the trigger's run is created, the run is
 * recorded in the definition's `_meta.ahpd`, beside `pinnedSession`, and the
 * automation is consumed: no next run, and no update. VS Code records it in
 * the entry's `_meta`; the definition is where this host's stores keep what is
 * the host's, so a restart reads it back from the automation's own file.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1813-L1826
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1737-L1741
 */
import { ONE_TIME_TRIGGER } from '../types/automations-next.js';
import type { AutomationOneTimeTrigger } from '../types/automations-next.js';

/** The key under the definition's `_meta.ahpd` that names the run its one-time trigger created. */
export const ONE_TIME_RUN_KEY = 'oneTimeRun';

const recordOf = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** The definition's one-time trigger, where it has one. */
export const oneTimeTriggerOf = (definition: unknown): AutomationOneTimeTrigger | undefined => {
  const triggers = recordOf(definition)['triggers'];
  if (!Array.isArray(triggers)) return undefined;
  const found = triggers.map(recordOf).find((one) => one['kind'] === ONE_TIME_TRIGGER);
  return found as AutomationOneTimeTrigger | undefined;
};

/** The run a consumed one-time automation created, where it has. */
export const oneTimeRunOf = (definition: unknown): string | undefined => {
  const run = recordOf(recordOf(recordOf(definition)['_meta'])['ahpd'])[ONE_TIME_RUN_KEY];
  return typeof run === 'string' && run !== '' ? run : undefined;
};

/** The definition with its one-time trigger consumed by `run`. */
export const consumedBy = (definition: Record<string, unknown>, run: string): Record<string, unknown> => {
  const meta = recordOf(definition['_meta']);
  return { ...definition, _meta: { ...meta, ahpd: { ...recordOf(meta['ahpd']), [ONE_TIME_RUN_KEY]: run } } };
};

/** An ISO 8601 time `Date` reads, and nothing for anything else. */
const instantOf = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : at;
};

/** When a one-time trigger runs, in ms, and nothing for a `runAt` that is not a time. */
export const oneTimeRunAt = (trigger: AutomationOneTimeTrigger): number | undefined => instantOf(trigger.runAt);

/** What is wrong with a definition's one-time trigger, in VS Code's words, or nothing. */
export const oneTimeProblem = (definition: unknown): string | undefined => {
  const trigger = oneTimeTriggerOf(definition);
  if (trigger === undefined) return undefined;
  const held = recordOf(definition);
  const conditions = held['disableConditions'];
  if (Array.isArray(conditions) && conditions.length > 0) return 'One-time automations do not support end dates.';
  if (Array.isArray(held['triggers']) && held['triggers'].length !== 1) return 'A one-time automation must have exactly one trigger.';
  if (oneTimeRunAt(trigger) === undefined) return `A one-time trigger needs runAt as an ISO 8601 time: ${String(trigger.runAt)}`;
  return undefined;
};
