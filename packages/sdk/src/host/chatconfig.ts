/**
 * The checks on a chat's own config: a property marked `chatMutable` may be
 * set per chat with `chat/configChanged`, and a client's write is checked
 * before it is taken. AHP 1.1.0 declares `ChatConfigState`,
 * `chat/configChanged` and `chatMutable`, and its chat reducer applies the
 * action; these checks are VS Code's, which the package has no copy of.
 *
 * From `sessionConfigProperties.ts` (`isChatConfigProperty`,
 * `filterChatConfigValues`, `validateChatConfigWrite`, and the part of
 * `getSessionConfigWriteError` that reads a property's own fields; its
 * approval-mode and workspace-property cases name keys this host does not
 * serve).
 * https://github.com/microsoft/agent-host-protocol/blob/v1.1.0/types/channels-chat/state.ts#L430-L462
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L136-L150
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L167-L180
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L367-L381
 */

/** One property of a session's config schema, in the fields of `SessionConfigPropertySchema` read here. */
export type ConfigProperty = {
  readonly enum?: readonly unknown[];
  readonly enumDynamic?: boolean;
  readonly readOnly?: boolean;
  readonly chatMutable?: boolean;
};

/** A session's config schema, in the fields of `SessionConfigSchema` read here. */
export type ConfigSchema = {
  readonly properties: Readonly<Record<string, ConfigProperty | undefined>>;
};

/** Whether a chat may set `key` for itself; every other property is set on the session. */
export function isChatConfigProperty(schema: ConfigSchema | undefined, key: string): boolean {
  return schema?.properties[key]?.chatMutable === true;
}

/** The values of `values` that the session's schema lets a chat set for itself. */
export function filterChatConfigValues(schema: ConfigSchema | undefined, values: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => value !== undefined && isChatConfigProperty(schema, key)));
}

/** `mutable`: whether the write may change the property at all. */
function getSessionConfigWriteError(schema: ConfigSchema, key: string, value: unknown, mutable: (property: ConfigProperty) => boolean): string | undefined {
  const property = schema.properties[key];
  if (!property || !mutable(property)) {
    return `Session configuration '${key}' is not writable.`;
  }
  if (value !== undefined && property.enum?.length && !property.enumDynamic && !property.enum.some((candidate) => candidate === value)) {
    return `Session configuration '${key}' does not offer '${String(value)}'.`;
  }
  return undefined;
}

/**
 * Throws when a client may not set `key` to `value` for a chat: the session's
 * write rules apply on top of the property being settable per chat.
 */
export function validateChatConfigWrite(schema: ConfigSchema, key: string, value: unknown): void {
  if (!isChatConfigProperty(schema, key)) {
    throw new Error(`Session configuration '${key}' cannot be set for a chat.`);
  }
  // A chat may set a `chatMutable` property for itself even when the session's value is fixed; read-only ones are host-written.
  const error = getSessionConfigWriteError(schema, key, value, (property) => property.readOnly !== true);
  if (error) {
    throw new Error(error);
  }
}
