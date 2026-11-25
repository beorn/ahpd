/**
 * The model option keys VS Code's agent host shares across its agents, and
 * how it writes one as a person's explicit choice.
 *
 * Vendored from VS Code's `agentModelConfiguration.ts`: the keys, the context
 * tiers, the legacy aliases an explicit value replaces, and the tier lookup.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/agentModelConfiguration.ts#L13-L167
 */
import { ReasoningEffortConfigKey } from './reasoningeffort.js';

/** A value `ModelSelection.config` carries. */
export type JsonPrimitive = string | number | boolean | null;

/** A model and the options it runs with, the protocol's `ModelSelection`. */
export interface ModelSelection {
  id: string;
  config?: Record<string, JsonPrimitive>;
}

/** One property of a model's `configSchema`, as far as these checks read it. */
export interface ModelConfigProperty {
  enum?: JsonPrimitive[];
  enumLabels?: string[];
  default?: unknown;
  readOnly?: boolean;
}

/** Model-configuration key for the selected context-window size, in tokens. */
export const ContextSizeConfigKey = 'contextSize';

/** The legacy key that stored the tier string, which Copilot still reads before {@link ContextSizeConfigKey}. */
export const ContextTierConfigKey = 'contextTier';

/** Copilot's alias of the `thinkingLevel` key, which Copilot reads when that key is absent. */
export const CopilotReasoningEffortConfigKey = 'reasoningEffort';

/** The context windows that can be requested without naming a size: a model's standard window, or its largest. */
export const modelContextTiers = ['default', 'long_context'] as const;
export type ModelContextTier = typeof modelContextTiers[number];

/** Other keys that carry the same option as a key, which an explicit value of that key supersedes. */
const modelConfigurationAliasKeys: Readonly<Record<string, readonly string[]>> = {
  [ContextSizeConfigKey]: [ContextTierConfigKey],
  [ReasoningEffortConfigKey]: [CopilotReasoningEffortConfigKey],
};

/** The key that says where an option's value came from, kept in `ModelSelection.config` beside it. */
export const modelConfigurationSourceKey = (key: string): string => `vscode.modelConfiguration.${key}.source`;

/**
 * Sets model options as explicit choices, so a provider applies them even
 * where a managed default owns the option, and removes each option's legacy
 * alias, which could otherwise override or contradict it. Other options are kept.
 */
export const withExplicitModelConfiguration = (selection: ModelSelection, values: Readonly<Record<string, JsonPrimitive>>): ModelSelection => {
  const config = { ...selection.config };
  for (const [key, value] of Object.entries(values)) {
    for (const alias of modelConfigurationAliasKeys[key] ?? []) {
      delete config[alias];
      delete config[modelConfigurationSourceKey(alias)];
    }
    config[key] = value;
    config[modelConfigurationSourceKey(key)] = 'explicit';
  }
  return { ...selection, config };
};

/** The context-window size a tier selects: the first (standard) window for `default`, the last (largest) for `long_context`. */
export const getContextSizeForTier = (property: ModelConfigProperty | undefined, tier: ModelContextTier): JsonPrimitive | undefined =>
  tier === 'long_context' ? property?.enum?.at(-1) : property?.enum?.[0];
