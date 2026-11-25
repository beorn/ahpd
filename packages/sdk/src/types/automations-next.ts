/**
 * The AHP 1.2.0 automation types this host uses before the package has them.
 *
 * Copied from AHP main at `e36b0a20`, where 1.2.0 is unreleased. Swapped for
 * the package's own when `@microsoft/agent-host-protocol` 1.2.0 ships.
 * https://github.com/microsoft/agent-host-protocol/blob/e36b0a20/types/channels-automation/state.ts
 * https://github.com/microsoft/agent-host-protocol/blob/e36b0a20/types/common/commands.ts
 */

/** The `oneTime` trigger kind, AHP's `AutomationTriggerKind.OneTime`. */
export const ONE_TIME_TRIGGER = 'oneTime';

/** Starts one run at a fixed time evaluated by the host. */
export interface AutomationOneTimeTrigger {
  /** Identifier unique and stable within this automation definition. */
  id: string;
  kind: typeof ONE_TIME_TRIGGER;
  /** Scheduled run timestamp in ISO 8601 format. */
  runAt: string;
  /** Policy when `runAt` passes while automatic execution is unavailable; `runOnce` when absent. */
  misfirePolicy?: 'runOnce' | 'skip';
}

/** Presence capability for one-time triggers. */
export type AutomationOneTimeCapability = Record<string, never>;

/** Where an automation's runs send their message, AHP's `AutomationTargetKind`. */
export const TARGET_KINDS = ['newSession', 'previousSession', 'chat'] as const;

/** Each run creates a session from the definition's template. */
export interface AutomationNewSessionTarget {
  kind: 'newSession';
}

/** Each run continues the session of the automation's previous run. */
export interface AutomationPreviousSessionTarget {
  kind: 'previousSession';
}

/** Each run sends its message to one existing chat. */
export interface AutomationChatTarget {
  kind: 'chat';
  /** The session that owns `chat`, which the host keeps. */
  session: string;
  /** The chat that receives each run's message. */
  chat: string;
}

/** Where the runs of an automation send its message; absent is `newSession`. */
export type AutomationTarget = AutomationNewSessionTarget | AutomationPreviousSessionTarget | AutomationChatTarget;

/** Which targets a definition may set; absent means each run creates a session. */
export interface AutomationTargetsCapabilities {
  previousSession?: Record<string, never>;
  chat?: Record<string, never>;
}
