/**
 * The reasoning effort and context tier `create_session` takes, as VS Code's
 * host checks them against a model's `configSchema` and writes them into the
 * new chat's `ModelSelection.config`.
 *
 * The messages are the reference host's, because a model that got a refusal
 * there fixes the call from its text. VS Code's model routers have no
 * counterpart here, so their refusal is not ported.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1028-L1111
 */
import { reasoningEffortLevels, ReasoningEffortConfigKey } from '../vscode/reasoningeffort.js';
import type { ReasoningEffortLevel } from '../vscode/reasoningeffort.js';
import { ContextSizeConfigKey, getContextSizeForTier, modelContextTiers, withExplicitModelConfiguration } from '../vscode/modelconfiguration.js';
import type { JsonPrimitive, ModelConfigProperty, ModelContextTier, ModelSelection } from '../vscode/modelconfiguration.js';

/** The root key that lets agents choose model options in `create_session`, VS Code's `sessionModelOptions`. */
export const SESSION_MODEL_OPTIONS = 'sessionModelOptions';

/** `off`, `inline` or `tool`: what the root config says of {@link SESSION_MODEL_OPTIONS}, `off` for anything else. */
export type SessionModelOptions = 'off' | 'inline' | 'tool';
export const sessionModelOptionsOf = (rootConfig: Readonly<Record<string, unknown>> | undefined): SessionModelOptions => {
  const value = rootConfig?.[SESSION_MODEL_OPTIONS];
  return value === 'inline' || value === 'tool' ? value : 'off';
};

/** The options a call asked the new chat's model for. */
export interface CreatedModelOptions {
  reasoningEffort?: ReasoningEffortLevel;
  contextTier?: ModelContextTier;
}

/** A catalog model, with the schema of the options it offers. */
export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  configSchema?: Record<string, unknown>;
}

const TOOL = 'create_session';

/** `create_session`'s two option properties, with VS Code's descriptions. */
export const createSessionModelOptionsProperties = {
  reasoningEffort: {
    type: 'string',
    enum: [...reasoningEffortLevels],
    description: 'Optional reasoning effort for the new chat\'s model (`xhigh` is shown as Extra High). Supported values depend on the model. Higher effort is slower and can cost more; `ultra` also delegates parts of the task automatically. Omit to keep the current chat\'s effort when `model` is omitted or names the current chat\'s model; otherwise the model\'s default is used.',
  },
  contextTier: {
    type: 'string',
    enum: [...modelContextTiers],
    description: 'Optional context window for the new chat\'s model: `long_context` uses the model\'s larger window when it offers one, which can cost more. Omit to keep the current chat\'s context size when `model` is omitted or names the current chat\'s model; otherwise the model\'s default is used.',
  },
};

/** `create_session`'s `model` description while agents can choose model options. */
export const CREATE_SESSION_MODEL_OPTIONS_DESCRIPTION = 'Optional model ID or display name. Defaults to the current chat\'s model, with its reasoning effort and context size. For `currentSession`, the model must belong to the current session\'s provider; for `independent`, the model selects the new session\'s provider.';

const optionalEnum = <T extends string>(value: unknown, field: string, values: readonly T[]): T | undefined => {
  if (value === undefined) return undefined;
  const match = values.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Invalid ${TOOL} input: ${field} must be one of: ${values.join(', ')}.`);
  return match;
};

/** The options a call names, read only while agents can choose them; otherwise both are ignored. */
export const createdModelOptionsOf = (input: Readonly<Record<string, unknown>>, on: boolean): CreatedModelOptions | undefined => {
  if (!on) return undefined;
  const reasoningEffort = optionalEnum(input.reasoningEffort, 'reasoningEffort', reasoningEffortLevels);
  const contextTier = optionalEnum(input.contextTier, 'contextTier', modelContextTiers);
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(contextTier !== undefined ? { contextTier } : {}),
  };
};

const propertyOf = (model: CatalogModel, key: string): ModelConfigProperty | undefined => {
  const properties = (model.configSchema as { properties?: Record<string, ModelConfigProperty> } | undefined)?.properties;
  return properties?.[key];
};

/** Lists a model option's values for the agent, each with its label when the label differs. */
const describeConfigValues = (property: ModelConfigProperty): string =>
  (property.enum ?? []).map((value, index) => {
    const label = property.enumLabels?.[index];
    return label !== undefined && label !== String(value) ? `${String(value)} (${label})` : String(value);
  }).join(', ');

const assertConfigWritable = (property: ModelConfigProperty, field: string, modelId: string): void => {
  if (property.readOnly === true)
    throw new Error(`Invalid ${TOOL} input: ${field} is locked for model "${modelId}" and can't be changed. Omit ${field}.`);
};

/**
 * The new chat's model selection.
 *
 * No `model` starts from the calling chat's selection, so the new chat keeps
 * its effort and context size; with options on, a `model` naming the calling
 * chat's model does too. Requested options are then set as explicit choices,
 * once the model's catalog entry shows that it offers them. `undefined`
 * leaves the model to the provider.
 *
 * @param asked The model the call named, by id.
 * @param options The options asked for, or `undefined` while agents cannot choose them.
 * @param inherited The calling chat's selection, when the new chat runs the calling chat's agent.
 */
export const resolveCreatedModelSelection = (
  asked: string | undefined, options: CreatedModelOptions | undefined, provider: string,
  inherited: ModelSelection | undefined, models: () => readonly CatalogModel[],
): ModelSelection | undefined => {
  const selection = asked === undefined || (options !== undefined && inherited?.id === asked) ? inherited : { id: asked };
  if (options?.reasoningEffort === undefined && options?.contextTier === undefined) return selection;
  const requested = options.reasoningEffort === undefined ? 'contextTier' : options.contextTier === undefined ? 'reasoningEffort' : 'reasoningEffort and contextTier';
  if (selection === undefined)
    throw new Error(`Invalid ${TOOL} input: ${requested} needs a model, but the new chat has no model to inherit. Pass \`model\` as well.`);
  const model = models().find((candidate) => candidate.provider === provider && candidate.id === selection.id);
  if (!model)
    throw new Error(`Invalid ${TOOL} input: can't check ${requested} because model "${selection.id}" isn't among the available models right now. Retry, or pass \`model\` with an available model.`);
  const values: Record<string, JsonPrimitive> = {};
  if (options.reasoningEffort !== undefined) {
    const property = propertyOf(model, ReasoningEffortConfigKey);
    if (!property?.enum?.includes(options.reasoningEffort)) {
      throw new Error(property?.enum?.length
        ? `Invalid ${TOOL} input: model "${model.id}" doesn't support reasoningEffort "${options.reasoningEffort}". Use one of: ${describeConfigValues(property)}, or omit reasoningEffort.`
        : `Invalid ${TOOL} input: model "${model.id}" has no reasoning effort option. Omit reasoningEffort.`);
    }
    assertConfigWritable(property, 'reasoningEffort', model.id);
    values[ReasoningEffortConfigKey] = options.reasoningEffort;
  }
  if (options.contextTier !== undefined) {
    const property = propertyOf(model, ContextSizeConfigKey);
    const size = property?.enum && property.enum.length > 1 ? getContextSizeForTier(property, options.contextTier) : undefined;
    if (property === undefined || size === undefined)
      throw new Error(`Invalid ${TOOL} input: model "${model.id}" has a single context window, so contextTier doesn't apply. Omit contextTier, or pass a model with a larger context window.`);
    assertConfigWritable(property, 'contextTier', model.id);
    values[ContextSizeConfigKey] = size;
  }
  return withExplicitModelConfiguration(selection, values);
};

/** The `reasoningEffort` and `contextTier` values `create_session` accepts for a model, as {@link resolveCreatedModelSelection} checks them: none for a locked option. */
export const describeCreateSessionModelOptions = (model: CatalogModel): string | undefined => {
  const options: string[] = [];
  const effort = propertyOf(model, ReasoningEffortConfigKey);
  if (effort?.enum?.length && effort.readOnly !== true) {
    const defaultEffort = typeof effort.default === 'string' ? `, default ${effort.default}` : '';
    options.push(`reasoningEffort ${effort.enum.join('|')}${defaultEffort}`);
  }
  const context = propertyOf(model, ContextSizeConfigKey);
  if (context?.enum && context.enum.length > 1 && context.readOnly !== true) options.push('contextTier long_context');
  return options.length > 0 ? options.join('; ') : undefined;
};
