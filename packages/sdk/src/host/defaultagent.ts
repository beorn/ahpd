import { mayUseAgentFor, ownershipOf } from '../agents/usable.js';
import type { Acting } from '../agents/usable.js';
import type { Agent } from '../types/agent.js';
import { agentRefusal } from './common.js';
import type { HostContext } from './context.js';

/** The root config key that names the agent of a create that names none. */
export const DEFAULT_AGENT = 'defaultAgent';

/** What a create that names no agent says about itself. */
export interface DefaultAsked {
  /** Whether whoever the create is for may use an agent, by its provider. */
  may: (provider: string) => boolean;
  /** The plugin that asks for a chat in a session of its own agent: none of its agents is the default there. */
  by?: string | undefined;
  /** Whether the work runs on a computer, so a program missing on this host says nothing. */
  onComputer?: boolean;
}

/** Whether the owner work acts for may use an agent, for `DefaultAsked.may`. */
export const ownerMay = (ctx: HostContext, acting: Acting | undefined) => (provider: string): boolean =>
  mayUseAgentFor(acting, ownershipOf(ctx.options.agentOwners?.(), provider), { hasDirectory: ctx.options.users !== undefined });

/**
 * The agent a create that names none runs on.
 *
 * The one the root config's `defaultAgent` names, which is then checked as a
 * named agent is. With none set, the first agent that is on, that the caller
 * may use and whose program is not missing; else the first that is on and may
 * be used, whose start says which program is missing; else the first agent of
 * the host, whose refusal the caller hears.
 */
export const defaultAgentFor = (ctx: HostContext, asked: DefaultAsked): string | undefined => {
  const { options } = ctx;
  const own = (provider: string): boolean => asked.by !== undefined && options.agentStarts?.[provider]?.by === asked.by;
  const chosen = ctx.rootConfig[DEFAULT_AGENT];
  if (typeof chosen === 'string' && chosen !== '' && !own(chosen)) return chosen;
  const missing = (agent: Agent): boolean => asked.onComputer !== true && agent.missingProgram?.() !== undefined;
  const others = [...ctx.agents.values()].filter((agent) => !own(agent.provider));
  const usable = others.filter((agent) =>
    agentRefusal(options.disabledAgents?.(), options.pausedAgents?.(), agent.provider) === undefined && asked.may(agent.provider));
  return (usable.find((agent) => !missing(agent)) ?? usable[0] ?? others[0])?.provider;
};
