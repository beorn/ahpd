import type { TimingAttributes } from './telemetry.js';

/** The span a window's first-response record becomes, as VS Code names it. */
export const AGENT_HOST_FIRST_RESPONSE_SPAN = 'vscode.agent_host.first_response';
/** The prefix every attribute of that span carries. */
export const AGENT_HOST_TIMING_PREFIX = 'vscode.agent_host.';
/** The span a window's user-interaction record becomes, as VS Code names it. */
export const USER_INTERACTION_SPAN = 'vscode.chat.user_perceived_time_to_first_progress';
/** The prefix every attribute of that span carries. */
export const USER_INTERACTION_PREFIX = 'vscode.chat.user_interaction.';

/** The connection kinds `agentHostClientConnectionKindValidator` accepts. */
const CONNECTION_KINDS = [
  'local', 'direct_websocket', 'dev_tunnel', 'dev_container', 'ssh', 'wsl',
  'remote_extension_host', 'web_pub_sub', 'mission_control', 'unknown',
] as const;
type ConnectionKind = typeof CONNECTION_KINDS[number];

/** The outcomes a first-response record may report. */
const FIRST_RESPONSE_OUTCOMES = ['success', 'cancelled', 'error', 'notDispatched'] as const;
type FirstResponseOutcome = typeof FIRST_RESPONSE_OUTCOMES[number];

/** Whether a first-response record was the session's first turn or a later one. */
const SESSION_TURN_KINDS = ['first', 'later', 'unknown'] as const;
type SessionTurnKind = typeof SESSION_TURN_KINDS[number];

/** How the renderer reached its provider. */
const INVOCATION_KINDS = ['newTurn', 'existingTurn', 'subagent', 'unknown'] as const;
type InvocationKind = typeof INVOCATION_KINDS[number];

/** The results a user-interaction observation may report. */
const USER_INTERACTION_RESULTS = [
  'success', 'cancelled', 'error', 'completedWithoutProgress', 'notDispatched',
  'queued', 'navigated', 'hidden', 'disposed',
] as const;
type UserInteractionResult = typeof USER_INTERACTION_RESULTS[number];

/** Which request of the chat the observation belongs to. */
const REQUEST_PHASES = ['first', 'followup', 'unknown'] as const;
type RequestPhase = typeof REQUEST_PHASES[number];

/** The progress that first made the interaction perceptible. */
const FIRST_PROGRESS_KINDS = ['text', 'reasoning', 'tool'] as const;
type FirstProgressKind = typeof FIRST_PROGRESS_KINDS[number];

/** A first-response record whose fields VS Code's validator accepts. */
export interface FirstResponseRecord {
  requestId: string;
  provider: string;
  connectionKind?: ConnectionKind;
  agentSessionId?: string;
  chatId?: string;
  outcome: FirstResponseOutcome;
  sessionTurnKind: SessionTurnKind;
  invocationKind: InvocationKind;
  firstResponseTextMs?: number;
  rootToolCallsBeforeFirstText?: number;
  rendererRootInvocationOrdinal?: number;
  trustInteractionRequired: boolean;
  totalElapsedMs: number;
  hasResponseText: boolean;
}

/** A user-interaction record whose fields VS Code's validator accepts. */
export interface UserInteractionRecord {
  schemaVersion: number;
  rendererId: string;
  interactionOrdinal: number;
  requestId?: string;
  result: UserInteractionResult;
  requestPhase: RequestPhase;
  firstProgressKind?: FirstProgressKind;
  timeToFirstProgress?: number;
  timeToTermination?: number;
  windowVisible: boolean;
  windowFocused: boolean;
}

/** Whether a value is a JSON object, as `vObj` requires. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value is a string, as `vString` requires. */
const isString = (value: unknown): value is string => typeof value === 'string';

/** Whether a value is a finite number, as `vNumber` requires. */
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Whether a value is a boolean, as `vBoolean` requires. */
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Whether a value is a string or absent, as `vOptionalProp(vString())` requires. */
const isOptionalString = (value: unknown): value is string | undefined => value === undefined || isString(value);

/** Whether a value is a finite number or absent, as `vOptionalProp(vNumber())` requires. */
const isOptionalNumber = (value: unknown): value is number | undefined => value === undefined || isNumber(value);

/** The member of `values` a value names, or undefined when it names none of them. */
const asOneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : undefined;

/** An identifier a record may carry: opaque, bounded, and never a URI. */
const isIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[\w.-]{1,256}$/.test(value);

/**
 * A first-response record read through `agentHostFirstResponseValidator`'s
 * shape, with every undeclared key left out.
 */
export const firstResponseRecord = (value: unknown): FirstResponseRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    requestId, provider, connectionKind, agentSessionId, chatId, outcome, sessionTurnKind, invocationKind,
    firstResponseTextMs, rootToolCallsBeforeFirstText, rendererRootInvocationOrdinal,
    trustInteractionRequired, totalElapsedMs, hasResponseText,
  } = value;
  if (!isString(requestId) || !isString(provider)) return undefined;
  if (!isOptionalString(agentSessionId) || !isOptionalString(chatId)) return undefined;
  if (!isOptionalNumber(firstResponseTextMs) || !isOptionalNumber(rootToolCallsBeforeFirstText)
    || !isOptionalNumber(rendererRootInvocationOrdinal)) return undefined;
  if (!isBoolean(trustInteractionRequired) || !isNumber(totalElapsedMs) || !isBoolean(hasResponseText)) return undefined;
  const reportedOutcome = asOneOf(FIRST_RESPONSE_OUTCOMES, outcome);
  const reportedTurn = asOneOf(SESSION_TURN_KINDS, sessionTurnKind);
  const reportedInvocation = asOneOf(INVOCATION_KINDS, invocationKind);
  if (reportedOutcome === undefined || reportedTurn === undefined || reportedInvocation === undefined) return undefined;
  const reportedConnection = connectionKind === undefined ? undefined : asOneOf(CONNECTION_KINDS, connectionKind);
  if (connectionKind !== undefined && reportedConnection === undefined) return undefined;
  return {
    requestId,
    provider,
    ...(reportedConnection === undefined ? {} : { connectionKind: reportedConnection }),
    ...(agentSessionId === undefined ? {} : { agentSessionId }),
    ...(chatId === undefined ? {} : { chatId }),
    outcome: reportedOutcome,
    sessionTurnKind: reportedTurn,
    invocationKind: reportedInvocation,
    ...(firstResponseTextMs === undefined ? {} : { firstResponseTextMs }),
    ...(rootToolCallsBeforeFirstText === undefined ? {} : { rootToolCallsBeforeFirstText }),
    ...(rendererRootInvocationOrdinal === undefined ? {} : { rendererRootInvocationOrdinal }),
    trustInteractionRequired,
    totalElapsedMs,
    hasResponseText,
  };
};

/**
 * The attributes `vscode.agent_host.first_response` carries for a record, or
 * undefined when its provider or request id is not an identifier.
 *
 * Measurements are kept only where they are finite and non-negative, and the
 * two before the first text only where the record says there was text.
 */
export const firstResponseAttributes = (record: FirstResponseRecord): TimingAttributes | undefined => {
  if (!isIdentifier(record.provider) || !isIdentifier(record.requestId)) return undefined;
  const attributes: TimingAttributes = {};
  const put = (key: string, value: string | number | boolean): void => {
    attributes[`${AGENT_HOST_TIMING_PREFIX}${key}`] = value;
  };
  const measure = (key: string, value: number | undefined): void => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) put(key, value);
  };
  put('schemaVersion', 1);
  put('source', 'renderer');
  put('provider', record.provider);
  put('turnId', record.requestId);
  for (const key of ['agentSessionId', 'chatId'] as const) {
    const value = record[key];
    if (isIdentifier(value)) put(key, value);
  }
  put('requestId', record.requestId);
  if (record.connectionKind !== undefined) put('connectionKind', record.connectionKind);
  put('outcome', record.outcome);
  put('sessionTurnKind', record.sessionTurnKind);
  put('invocationKind', record.invocationKind);
  put('trustInteractionRequired', record.trustInteractionRequired);
  put('hasResponseText', record.hasResponseText);
  if (record.hasResponseText) {
    measure('firstResponseTextMs', record.firstResponseTextMs);
    measure('rootToolCallsBeforeFirstText', record.rootToolCallsBeforeFirstText);
  }
  measure('rendererRootInvocationOrdinal', record.rendererRootInvocationOrdinal);
  measure('totalElapsedMs', record.totalElapsedMs);
  return attributes;
};

/**
 * A user-interaction record read through `chatUserInteractionValidator`'s
 * shape, with every undeclared key left out.
 */
export const userInteractionRecord = (value: unknown): UserInteractionRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    schemaVersion, rendererId, interactionOrdinal, requestId, result, requestPhase,
    firstProgressKind, timeToFirstProgress, timeToTermination, windowVisible, windowFocused,
  } = value;
  if (!isNumber(schemaVersion) || !isString(rendererId) || !isNumber(interactionOrdinal)) return undefined;
  if (!isOptionalString(requestId) || !isOptionalNumber(timeToFirstProgress) || !isOptionalNumber(timeToTermination)) return undefined;
  if (!isBoolean(windowVisible) || !isBoolean(windowFocused)) return undefined;
  const reportedResult = asOneOf(USER_INTERACTION_RESULTS, result);
  const reportedPhase = asOneOf(REQUEST_PHASES, requestPhase);
  if (reportedResult === undefined || reportedPhase === undefined) return undefined;
  const reportedProgress = firstProgressKind === undefined ? undefined : asOneOf(FIRST_PROGRESS_KINDS, firstProgressKind);
  if (firstProgressKind !== undefined && reportedProgress === undefined) return undefined;
  return {
    schemaVersion,
    rendererId,
    interactionOrdinal,
    ...(requestId === undefined ? {} : { requestId }),
    result: reportedResult,
    requestPhase: reportedPhase,
    ...(reportedProgress === undefined ? {} : { firstProgressKind: reportedProgress }),
    ...(timeToFirstProgress === undefined ? {} : { timeToFirstProgress }),
    ...(timeToTermination === undefined ? {} : { timeToTermination }),
    windowVisible,
    windowFocused,
  };
};

/**
 * The attributes `vscode.chat.user_perceived_time_to_first_progress` carries
 * for a record, or undefined when the record cannot describe an observation.
 *
 * A success names a request, a kind of first progress and a visible window,
 * and carries no termination time; every other result carries neither of the
 * two success fields. The duration is read from the field the result names.
 */
export const userInteractionAttributes = (record: UserInteractionRecord): TimingAttributes | undefined => {
  const duration = record.result === 'success' ? record.timeToFirstProgress : record.timeToTermination;
  if (record.schemaVersion !== 1 || !isIdentifier(record.rendererId)
    || (record.requestId !== undefined && !isIdentifier(record.requestId))
    || !Number.isSafeInteger(record.interactionOrdinal) || record.interactionOrdinal < 1
    || duration === undefined || !Number.isFinite(duration) || duration < 0
    || (record.result === 'success'
      ? !record.requestId || !record.firstProgressKind || !record.windowVisible || record.timeToTermination !== undefined
      : record.firstProgressKind !== undefined || record.timeToFirstProgress !== undefined)) return undefined;
  const attributes: TimingAttributes = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) attributes[`${USER_INTERACTION_PREFIX}${key}`] = value as string | number | boolean;
  }
  return attributes;
};
