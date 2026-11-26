---
title: A default agent is chosen
domain: host
status: active
priority: high
created: 2026-11-25
revalidated: 2026-11-25
changes:
  - specs/agent-backends.md
refs:
  - git://e06dbc28f - main when the plan was made
  - "[code://packages/sdk/src/host/tooling.ts#L2075-L2093](../../../../packages/sdk/src/host/tooling.ts#L2075-L2093) - the default of a plugin chat: the first agent that is on and is not the plugin own"
  - "[code://packages/sdk/src/host/tooling.ts#L2440](../../../../packages/sdk/src/host/tooling.ts#L2440) - a session a tool makes inherits the agent of the calling chat, else takes `ctx.first`"
  - "[code://packages/sdk/src/host/tooling.ts#L2751](../../../../packages/sdk/src/host/tooling.ts#L2751) - a session made with no calling chat takes `ctx.first`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1344](../../../../packages/sdk/src/host/sessionmethods.ts#L1344) - `createSession` takes `ctx.first`, then refuses one that is off"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L2100](../../../../packages/sdk/src/host/sessionmethods.ts#L2100) - `resolveSessionConfig` takes `ctx.first`, so the form it answers must match the create"
  - "[code://packages/sdk/src/host/automations.ts#L839](../../../../packages/sdk/src/host/automations.ts#L839) - a plugin or automation start takes `ctx.first`"
  - "[code://packages/sdk/src/host/root.ts#L419](../../../../packages/sdk/src/host/root.ts#L419) - `ROOT_CONFIG_SCHEMA`, where `defaultShell` is the pattern for a setting of this host"
  - "[code://packages/sdk/src/host/root.ts#L799](../../../../packages/sdk/src/host/root.ts#L799) - `rootFor`, which builds the config schema for one connection"
  - "[code://packages/sdk/src/host/common.ts#L75](../../../../packages/sdk/src/host/common.ts#L75) - `agentRefusal`, the sentence for an agent that is off or paused"
  - "[code://packages/sdk/src/utils/onpath.ts](../../../../packages/sdk/src/utils/onpath.ts) - `onPath`, the lookup that finds a command on POSIX and Windows"
  - "[code://packages/agent-acp/src/connection.ts#L158-L166](../../../../packages/agent-acp/src/connection.ts#L158-L166) - the sentence for a program that is not found"
---

## Goal

A create that names no agent runs on an agent the person chose as the default. When no default is chosen, the host takes the first agent that is on and whose program is found. Today it takes the first agent that loaded, so a new bot ran on Amp, whose program is not installed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep "ctx.first" packages/*/src` - five places choose an agent for a create; `outputs.ts` and `snapshots.ts` use it to read a session with no owner.
- `git grep -i "defaultAgent|defaultProvider"` - Not found: no setting names a default agent.

### Runtime path

```
create with no provider -> defaultAgent(ctx, caller) -> root config `defaultAgent`, else the first agent found -> the checks a named agent gets -> start
```

### Gaps

- No setting names the default agent.
- `Agent` has no way to say that its program is not found.
- Four of the five creates do not skip an agent that is off.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A host setting names the default agent. With none, the first agent that is on and whose program is found | Softov, 2026-11-25, chose "Setting, else first found" | 01, 02 |
| One rule wherever no agent is named: bots, sessions, automations, tools | Softov, 2026-11-25, chose "Everywhere no agent is named" | 02 |
| A tool that inherits the agent of the calling chat still inherits it | Softov, 2026-11-25, chose "Everywhere no agent is named", whose text says so | 02 |
| The setting is the root config key `defaultAgent`, a provider id | (defaulted: `defaultShell` is the pattern) | 02 |
| A chosen agent is treated as a named one: when it is off, paused or not served, the create is refused with that sentence | (defaulted: a quiet switch would hide that the choice does not work) | 02 |
| The first found agent is also one the caller may use | (defaulted: the next check would refuse it) | 02 |
| When no program is found, the first agent that is on and that the caller may use is taken, as today, so the start fails with its own sentence | (defaulted: the sentence names the missing program) | 02 |
| A plugin chat never runs on an agent of that plugin, also when the setting names one | (defaulted: a Back on `bot-chat` would wake itself) | 02 |
| Only `agent-acp` answers the check in this plan; an agent with no check counts as found | (defaulted: the other three agents run a package they ship) | 01 |
| A create on a computer does not ask the check | (defaulted: the program is in the machine. A record's `machine` block is only what it needs there, and the shipped rows have one) | 01, 02 |
| `outputs.ts` and `snapshots.ts` keep `ctx.first` | (defaulted: they read old sessions, and start nothing) | 02 |

## Proposed architecture

- **Data flow** - `defaultAgentFor(ctx, caller, by?)` answers a provider id or nothing. The creates call it in place of `ctx.first?.provider`.
- **Event flow** - unchanged; the setting arrives as `root/configChanged`.
- **State flow** - the setting is kept in the root config store. The program check is asked at each create and keeps nothing.
- **Layer responsibilities** - sdk: the rule, the setting and `onPath` · agent-acp: the check · server: imports `onPath` from the sdk.
- **Source-of-truth files** - [`code://packages/sdk/src/host/defaultagent.ts`](../../../../packages/sdk/src/host/defaultagent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an agent says its program is missing](task-01-an-agent-says-its-program-is-missing.md) | done | - |
| [02 - every create asks one rule](task-02-every-create-asks-one-rule.md) | done | 01 |

## Risks and tradeoffs

- A create with no agent can land on a different agent than before. The release notes say so in Upgrading.
- A program that is found can still be signed out. The check does not answer that.
- With no default chosen, the load order still decides between the agents that are found.

## Resume state

- **Done so far:** both tasks, on 2026-11-25. [implemented.md](implemented.md) holds the checks.
- **Next action:** Softov's review.
- **Open questions:** none.
- **Watch out for:** `resolveSessionConfig` and `createSession` must answer the same agent, or the form draws the settings of another one.

## Final verification checklist

- [ ] With `defaultAgent` unset and Amp first and not installed, a new bot answers on the next found agent.
- [ ] With `defaultAgent` set, a bot, a session, an automation and a tool use it.
- [ ] A default that is off is refused with the sentence for it.
- [ ] `pnpm typecheck`, the suites of sdk, server, agent-acp, bot and computer, and `pnpm docs:build` pass.
