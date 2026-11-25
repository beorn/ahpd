/*
 * A conversation a client stages for a session it is about to create.
 *
 * Chunks arrive on `vscode/stageCreateSessionImportChunk` and are held on the
 * connection that sent them. `createSession` names them by `transferId` in its
 * `_meta`, takes the joined text, and reads the value the reference host
 * reads. Nothing here starts a session: what the turns become is the agent's
 * business, and `importConversation` is where it is handed them.
 */

import { randomUUID } from 'node:crypto';
import type { ModelSelection, Turn } from '@microsoft/agent-host-protocol';

/** The `createSession` `_meta` key carrying a conversation to import. */
export const CREATE_SESSION_IMPORT_META = 'vscode.importConversation';

/** The most UTF-16 code units one chunk may hold. */
export const CREATE_SESSION_IMPORT_CHUNK_CHARS = 1024 * 1024;

/** The most UTF-16 code units one connection may stage before its chunks are taken. */
export const CREATE_SESSION_IMPORT_MAX_STAGED_CHARS = 256 * 1024 * 1024;

/** The method one chunk is staged with. */
export const STAGE_CREATE_SESSION_IMPORT_METHOD = 'vscode/stageCreateSessionImportChunk';

/** A conversation a client asked to import, as its value on the wire is read. */
export interface CreateSessionImport {
  turns: Turn[];
  model?: ModelSelection;
  title?: string;
}

/** The chunks one connection has staged, and the characters they hold. */
export interface StagedImports {
  transfers: Map<string, string[]>;
  totalChars: number;
}

/** The staged chunks of a connection that has staged none. */
export const noStagedImports = (): StagedImports => ({ transfers: new Map(), totalChars: 0 });

/** What staging one chunk did. */
export type StageResult = 'staged' | 'invalid' | 'exceeds';

/** Drop one transfer and the characters it held. */
const dropTransfer = (state: StagedImports, transferId: string): void => {
  const chunks = state.transfers.get(transferId);
  if (chunks === undefined) return;
  state.transfers.delete(transferId);
  for (const chunk of chunks) state.totalChars = Math.max(0, state.totalChars - chunk.length);
};

/**
 * Hold one chunk under `transferId`.
 *
 * A chunk with a blank transfer id, no text, or more characters than the chunk
 * limit is refused and holds nothing. A chunk that would put the connection
 * past its staged limit drops the transfer under that id, as the reference
 * host drops it, and holds nothing.
 */
export const stageImportChunk = (state: StagedImports, transferId: string, chunk: string): StageResult => {
  if (transferId.trim() === '' || chunk.length === 0 || chunk.length > CREATE_SESSION_IMPORT_CHUNK_CHARS) return 'invalid';
  if (state.totalChars + chunk.length > CREATE_SESSION_IMPORT_MAX_STAGED_CHARS) {
    dropTransfer(state, transferId);
    return 'exceeds';
  }
  let chunks = state.transfers.get(transferId);
  if (chunks === undefined) {
    chunks = [];
    state.transfers.set(transferId, chunks);
  }
  chunks.push(chunk);
  state.totalChars += chunk.length;
  return 'staged';
};

/** Take the joined text of a staged transfer, dropping it, or nothing where no such transfer is held. */
export const takeImport = (state: StagedImports, transferId: string): string | undefined => {
  const chunks = state.transfers.get(transferId);
  if (chunks === undefined) return undefined;
  state.transfers.delete(transferId);
  state.totalChars = Math.max(0, state.totalChars - chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  return chunks.join('');
};

/** Drop every staged transfer of a connection. */
export const dropImports = (state: StagedImports): void => {
  state.transfers.clear();
  state.totalChars = 0;
};

/** The turns, each with an id minted for the session it is imported into. */
export const freshTurnIds = (turns: Turn[]): Turn[] => turns.map((turn) => ({ ...turn, id: randomUUID() }));

const isBag = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Whether a value is absent or passes `check`. */
const optional = (check: (value: unknown) => boolean) => (value: unknown): boolean =>
  value === undefined || check(value);

/** Whether every entry of an array passes `check`. */
const isArrayOf = (check: (value: unknown) => boolean) => (value: unknown): boolean =>
  Array.isArray(value) && value.every((one) => check(one));

/** Whether a string is one of `values`. */
const oneOf = (...values: string[]) => (value: unknown): boolean =>
  typeof value === 'string' && values.includes(value);

/** Keys a record read from the wire may not carry, as the reference's reader refuses them. */
const DISALLOWED = new Set(['__proto__', 'constructor', 'prototype']);

/** Whether a record's entries all pass `check` and none names a prototype. */
const isRecordOf = (check: (value: unknown) => boolean) => (value: unknown): boolean => {
  if (!isBag(value)) return false;
  for (const [key, one] of Object.entries(value)) {
    if (DISALLOWED.has(key) || !check(one)) return false;
  }
  return true;
};

const isJsonPrimitive = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;

const isPrimitiveRecord = isRecordOf(isJsonPrimitive);
const isOpenRecord = isRecordOf(() => true);

const isStringOrMarkdown = (value: unknown): boolean =>
  isString(value) || (isBag(value) && isString(value.markdown));

const isTextPosition = (value: unknown): boolean =>
  isBag(value) && isNumber(value.line) && isNumber(value.character);

const isTextRange = (value: unknown): boolean =>
  isBag(value) && isTextPosition(value.start) && isTextPosition(value.end);

const isTextSelection = (value: unknown): boolean => isBag(value) && isTextRange(value.range);

const isContentRef = (value: unknown): boolean => isBag(value) && isString(value.uri)
  && optional(isNumber)(value.sizeHint) && optional(isString)(value.contentType) && optional(isString)(value.nonce);

const isModelSelection = (value: unknown): boolean =>
  isBag(value) && isString(value.id) && optional(isPrimitiveRecord)(value.config);

const isAgentSelection = (value: unknown): boolean => isBag(value) && isString(value.uri);

const isMessageAttachment = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  if (!isString(value.label) || !optional(isTextRange)(value.range)
    || !optional(isString)(value.displayKind) || !optional(isOpenRecord)(value._meta)) return false;
  switch (value.type) {
    case 'simple':
      return optional(isString)(value.modelRepresentation);
    case 'embeddedResource':
      return isString(value.data) && isString(value.contentType) && optional(isTextSelection)(value.selection);
    case 'resource':
      return isContentRef(value) && optional(isTextSelection)(value.selection);
    case 'annotations':
      return isString(value.resource) && optional(isArrayOf(isString))(value.annotationIds);
    case 'chat':
      return isString(value.resource) && optional(isString)(value.endTurn);
    default:
      return false;
  }
};

const isMessageOrigin = (value: unknown): boolean => isBag(value)
  && oneOf('user', 'agent', 'tool', 'automation', 'systemNotification')(value.kind);

const isMessage = (value: unknown): boolean => isBag(value) && isString(value.text) && isMessageOrigin(value.origin)
  && optional(isArrayOf(isMessageAttachment))(value.attachments)
  && optional(isModelSelection)(value.model)
  && optional(isAgentSelection)(value.agent)
  && optional(isOpenRecord)(value._meta);

const isErrorInfo = (value: unknown): boolean => isBag(value) && isString(value.errorType) && isString(value.message)
  && optional(isString)(value.stack) && optional(isOpenRecord)(value._meta);

const isUsageInfo = (value: unknown): boolean => isBag(value)
  && optional(isNumber)(value.inputTokens) && optional(isNumber)(value.outputTokens)
  && optional(isString)(value.model) && optional(isNumber)(value.cacheReadTokens)
  && optional(isOpenRecord)(value._meta);

const isFileEditSide = (value: unknown): boolean =>
  isBag(value) && isString(value.uri) && isContentRef(value.content);

const isDiffStats = (value: unknown): boolean =>
  isBag(value) && optional(isNumber)(value.added) && optional(isNumber)(value.removed);

const isFileEditFields = (value: Record<string, unknown>): boolean =>
  optional(isFileEditSide)(value.before) && optional(isFileEditSide)(value.after) && optional(isDiffStats)(value.diff);

const isFileEdit = (value: unknown): boolean => isBag(value) && isFileEditFields(value);

const isToolResultContent = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  switch (value.type) {
    case 'text':
      return isString(value.text);
    case 'embeddedResource':
      return isString(value.data) && isString(value.contentType);
    case 'resource':
      return isContentRef(value);
    case 'fileEdit':
      return isFileEditFields(value);
    case 'terminal':
      return isString(value.resource) && isString(value.title) && optional(isBoolean)(value.isPty)
        && optional((one) => isBag(one) && optional(isNumber)(one.exitCode)
          && optional(isString)(one.preview) && optional(isBoolean)(one.truncated))(value.result);
    case 'subagent':
      return isString(value.resource) && isString(value.title)
        && optional(isString)(value.agentName) && optional(isString)(value.description);
    default:
      return false;
  }
};

const isConfirmationOption = (value: unknown): boolean => isBag(value)
  && isString(value.id) && isString(value.label) && oneOf('approve', 'deny')(value.kind)
  && optional(isNumber)(value.group);

const isMcpContributor = (value: unknown): boolean =>
  isBag(value) && value.kind === 'mcp' && isString(value.customizationId);

const isContributor = (value: unknown): boolean => isBag(value)
  && (value.kind === 'client' ? isString(value.clientId) : value.kind === 'mcp' ? isString(value.customizationId) : false);

const isToolInput = (value: unknown): boolean => isString(value) || isContentRef(value);

const isToolCallBase = (value: Record<string, unknown>): boolean =>
  isString(value.toolCallId) && isString(value.toolName) && isString(value.displayName)
  && optional(isString)(value.intention) && optional(isContributor)(value.contributor)
  && optional(isBoolean)(value.requiresResultConfirmation) && optional(isOpenRecord)(value._meta);

const isToolCallParameters = (value: Record<string, unknown>): boolean =>
  isToolCallBase(value) && isStringOrMarkdown(value.invocationMessage) && optional(isToolInput)(value.toolInput);

const isToolCallPostConfirmation = (value: Record<string, unknown>): boolean =>
  isToolCallParameters(value) && oneOf('not-needed', 'user-action', 'setting')(value.confirmed)
  && optional(isConfirmationOption)(value.selectedOption);

const isToolCallResult = (value: Record<string, unknown>): boolean =>
  isBoolean(value.success) && isStringOrMarkdown(value.pastTenseMessage)
  && optional(isArrayOf(isToolResultContent))(value.content)
  && optional(isOpenRecord)(value.structuredContent)
  && optional(isOpenRecord)(value.resultMetadata)
  && optional((one) => isBag(one) && isString(one.message) && optional(isString)(one.code))(value.error);

const isToolCallRiskAssessment = (value: unknown): boolean => {
  if (!isBag(value) || value.kind !== 'judge') return false;
  if (value.status === 'loading') return true;
  return value.status === 'complete' && isStringOrMarkdown(value.reason) && isNumber(value.safety);
};

const isProtectedResourceMetadata = (value: unknown): boolean => isBag(value) && isString(value.resource)
  && optional(isString)(value.resource_name)
  && optional(isArrayOf(isString))(value.authorization_servers)
  && optional(isArrayOf(isString))(value.scopes_supported)
  && optional(isArrayOf(isString))(value.bearer_methods_supported)
  && optional(isString)(value.resource_documentation);

const isOAuthClient = (value: unknown): boolean =>
  isBag(value) && isString(value.clientId) && optional(isString)(value.clientSecret);

const isMcpAuthRequirement = (value: unknown): boolean => isBag(value)
  && oneOf('required', 'expired', 'insufficientScope')(value.reason)
  && optional(isOAuthClient)(value.oauthClient)
  && isProtectedResourceMetadata(value.resource)
  && optional(isArrayOf(isString))(value.requiredScopes)
  && optional(isString)(value.description);

const isToolCallState = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  switch (value.status) {
    case 'streaming':
      return isToolCallBase(value) && optional(isString)(value.partialInput)
        && optional(isStringOrMarkdown)(value.invocationMessage);
    case 'pending-confirmation':
      return isToolCallParameters(value)
        && optional(isStringOrMarkdown)(value.confirmationTitle)
        && optional(isToolCallRiskAssessment)(value.riskAssessment)
        && optional((one) => isBag(one) && isArrayOf(isFileEdit)(one.items))(value.edits)
        && optional(isBoolean)(value.editable)
        && optional(isArrayOf(isConfirmationOption))(value.options);
    case 'running':
      return isToolCallPostConfirmation(value) && optional(isArrayOf(isToolResultContent))(value.content);
    case 'auth-required':
      return isToolCallPostConfirmation(value) && isMcpContributor(value.contributor)
        && isMcpAuthRequirement(value.auth) && optional(isArrayOf(isToolResultContent))(value.content);
    case 'pending-result-confirmation':
    case 'completed':
      return isToolCallPostConfirmation(value) && isToolCallResult(value);
    case 'cancelled':
      return isToolCallParameters(value) && oneOf('denied', 'skipped', 'result-denied')(value.reason)
        && optional(isStringOrMarkdown)(value.reasonMessage)
        && optional(isMessage)(value.userSuggestion)
        && optional(isConfirmationOption)(value.selectedOption);
    default:
      return false;
  }
};

const isChatInputOption = (value: unknown): boolean => isBag(value)
  && isString(value.id) && isString(value.label)
  && optional(isString)(value.description) && optional(isBoolean)(value.recommended);

const isChatInputQuestion = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  if (!isString(value.id) || !optional(isString)(value.title) || !isString(value.message)
    || !optional(isBoolean)(value.required)) return false;
  switch (value.kind) {
    case 'text':
      return optional(isString)(value.format) && optional(isNumber)(value.min)
        && optional(isNumber)(value.max) && optional(isString)(value.defaultValue);
    case 'number':
    case 'integer':
      return optional(isNumber)(value.min) && optional(isNumber)(value.max) && optional(isNumber)(value.defaultValue);
    case 'boolean':
      return optional(isBoolean)(value.defaultValue);
    case 'single-select':
      return isArrayOf(isChatInputOption)(value.options) && optional(isBoolean)(value.allowFreeformInput);
    case 'multi-select':
      return isArrayOf(isChatInputOption)(value.options) && optional(isBoolean)(value.allowFreeformInput)
        && optional(isNumber)(value.min) && optional(isNumber)(value.max);
    default:
      return false;
  }
};

const isChatInputAnswerValue = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  switch (value.kind) {
    case 'text':
      return isString(value.value);
    case 'number':
      return isNumber(value.value);
    case 'boolean':
      return isBoolean(value.value);
    case 'selected':
      return isString(value.value) && optional(isArrayOf(isString))(value.freeformValues);
    case 'selected-many':
      return isArrayOf(isString)(value.value) && optional(isArrayOf(isString))(value.freeformValues);
    default:
      return false;
  }
};

const isChatInputAnswer = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  if (value.state === 'draft' || value.state === 'submitted') return isChatInputAnswerValue(value.value);
  return value.state === 'skipped' && optional(isArrayOf(isString))(value.freeformValues);
};

const isChatInputRequest = (value: unknown): boolean => isBag(value) && isString(value.id)
  && optional(isString)(value.message) && optional(isString)(value.url)
  && optional(isArrayOf(isChatInputQuestion))(value.questions)
  && optional(isRecordOf(isChatInputAnswer))(value.answers);

const isResponsePart = (value: unknown): boolean => {
  if (!isBag(value)) return false;
  switch (value.kind) {
    case 'markdown':
      return isString(value.id) && isString(value.content);
    case 'contentRef':
      return isContentRef(value);
    case 'toolCall':
      return isToolCallState(value.toolCall);
    case 'reasoning':
      return isString(value.id) && isString(value.content)
        && optional(isString)(value.startedAt) && optional(isNumber)(value.duration);
    case 'systemNotification':
      return isStringOrMarkdown(value.content) && optional(isOpenRecord)(value._meta);
    case 'inputRequest':
      return isChatInputRequest(value.request) && optional(oneOf('accept', 'decline', 'cancel'))(value.response);
    case 'error':
      return isErrorInfo(value.error) && optional(isBoolean)(value.resumable);
    default:
      return false;
  }
};

const isTurn = (value: unknown): boolean => isBag(value) && isString(value.id)
  && optional(isString)(value.startedAt) && optional(isNumber)(value.duration)
  && isMessage(value.message)
  && isArrayOf(isResponsePart)(value.responseParts)
  && optional(isUsageInfo)(value.usage)
  && oneOf('complete', 'cancelled', 'error')(value.state);

const isImportValue = (value: unknown): boolean => isBag(value) && isArrayOf(isTurn)(value.turns)
  && optional(isModelSelection)(value.model) && optional(isString)(value.title);

/**
 * A conversation import's value, or `'invalid'` for a value that is present but
 * malformed.
 *
 * A model with a blank id is malformed, as the reference's reader says.
 */
export const readCreateSessionImportValue = (value: unknown): CreateSessionImport | 'invalid' => {
  if (!isImportValue(value)) return 'invalid';
  const one = value as { turns: Turn[]; model?: ModelSelection; title?: string };
  if (one.model !== undefined && one.model.id.trim() === '') return 'invalid';
  return {
    turns: one.turns,
    ...(one.model === undefined ? {} : { model: one.model }),
    ...(one.title === undefined ? {} : { title: one.title }),
  };
};

/**
 * The conversation import a request's `_meta` carries, `'invalid'` for one that
 * is present but malformed, or nothing where it carries none.
 *
 * A staged reference is taken through `resolveStaged`, which returns the joined
 * text or nothing for a transfer the connection does not hold.
 */
export const readCreateSessionImportMeta = (
  meta: Record<string, unknown> | undefined,
  resolveStaged?: (transferId: string) => string | undefined,
): CreateSessionImport | undefined | 'invalid' => {
  const value = meta?.[CREATE_SESSION_IMPORT_META];
  if (value === undefined) return undefined;
  if (isBag(value) && !Object.hasOwn(value, 'turns') && Object.hasOwn(value, 'transferId')) {
    const transferId = value.transferId;
    if (!isString(transferId) || transferId.trim() === '' || resolveStaged === undefined) return 'invalid';
    const raw = resolveStaged(transferId);
    if (raw === undefined) return 'invalid';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    }
    catch {
      return 'invalid';
    }
    return readCreateSessionImportValue(parsed);
  }
  return readCreateSessionImportValue(value);
};
