---
title: The agents are listed in the order of their provider, each with its own description
created: 2026-11-13
refs:
  - git://549928e22 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/root.ts#L299-L301](../../packages/sdk/src/host/root.ts#L299-L301) - `descriptors`: the root's agents, in the order of the `agents` map"
  - "[code://packages/sdk/src/host/root.ts#L726](../../packages/sdk/src/host/root.ts#L726) - the root snapshot takes `descriptors()`"
  - "[code://packages/sdk/src/host/catalogue.ts#L1156-L1171](../../packages/sdk/src/host/catalogue.ts#L1156-L1171) - `root/agentsChanged` takes `descriptors()` too"
  - "[code://packages/sdk/src/host.ts#L242](../../packages/sdk/src/host.ts#L242) - the map at startup, in the order of `options.agents`"
  - "[code://packages/sdk/src/host.ts#L2046-L2053](../../packages/sdk/src/host.ts#L2046-L2053) - the map after a fold, in the fold's order, with a kept agent last"
  - "[code://packages/sdk/src/host/root.ts#L304-L306](../../packages/sdk/src/host/root.ts#L304-L306) - an agent with no `description` is described by its `displayName`"
  - "[code://packages/agent-claude/src/plugin.ts#L140-L157](../../packages/agent-claude/src/plugin.ts#L140-L157) - the Claude engine's `open` passes the record's name, not its description"
  - "[code://packages/agent-acp/src/plugin.ts#L454](../../packages/agent-acp/src/plugin.ts#L454) - the ACP engine passes the record's description"
  - "[code://packages/sdk/src/host/catalogue.ts#L1290-L1301](../../packages/sdk/src/host/catalogue.ts#L1290-L1301) - the session list uses the map's order to choose the row for an id that two backends list"
---

# The agents are listed in the order of their provider, each with its own description

Softov wants the agents in a snapshot sorted by `provider`.
A client shows the agents in the order the host sends them.
So the order must be the same on each host and after each restart.

He also wants an agent's own description used whenever it has one.

## What ahpd has today

- The root snapshot and `root/agentsChanged` send `descriptors()` ([`root.ts`](../../packages/sdk/src/host/root.ts#L299-L301)). It keeps the order of the `agents` map and removes the agents that are off or paused.
- At startup the map has the order of `options.agents` ([`host.ts`](../../packages/sdk/src/host.ts#L242)), which is the order the plugins load in.
- After a fold the map has the fold's order. An agent that the fold removed but that still has a running session goes last ([`host.ts`](../../packages/sdk/src/host.ts#L2046-L2053)).
- So the same agents can come in a different order on two hosts, or on one host before and after a change to the plugins.

## The description

- `descriptors()` sends `agent.description`, or `agent.displayName` when the agent has none ([`root.ts`](../../packages/sdk/src/host/root.ts#L304-L306)).
- An agent record has an optional `description`, which the agent channel keeps and lists.
- The ACP, cofold and pi engines pass the record's description to the agent.
- The Claude engine passes the record's id and name, but not its description ([`plugin.ts`](../../packages/agent-claude/src/plugin.ts#L140-L157)). The options of `claude()` have no `description`. So a Claude agent always has the description that `claude()` sets, `The Claude Agent SDK, on <dirs>` ([`claude.ts`](../../packages/agent-claude/src/claude.ts#L516)), also when its record has a description.

## Do not change

- The order of the `agents` map itself. When two backends list the same id, the session list uses this order to choose the row ([`catalogue.ts`](../../packages/sdk/src/host/catalogue.ts#L1290-L1301)). Some reads take the first agent of the map as the default. Sort only the list that `descriptors()` returns.

## Who writes

- No open PR and no worktree branch changes `packages/sdk/src/host/root.ts`, as checked on 2026-11-13.
- No open PR and no worktree branch changes `packages/agent-claude/src/plugin.ts` or `claude.ts`, as checked on 2026-11-13.

## Open

- The sort compares the `provider` string. Whether it is a plain code-point sort or a locale sort is not chosen.
- What VS Code's host does with the order of its agents is not checked.
