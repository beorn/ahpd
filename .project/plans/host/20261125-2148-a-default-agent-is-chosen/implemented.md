---
title: A default agent is chosen - implemented
date: 2026-11-25
---

## What exists now

- `defaultAgentFor` in [`code://packages/sdk/src/host/defaultagent.ts`](../../../../packages/sdk/src/host/defaultagent.ts) answers the agent of a create that names none. `createSession`, `resolveSessionConfig`, a plugin's or automation's start, the two `create_session` tools and a plugin's chat call it.
- The root config key `defaultAgent` is its first answer. A client reads the listed agents as its choices.
- `Agent.missingProgram` says which program is not found, and `agent-acp` answers it.
- `onPath` moved from the server to the sdk, unchanged.

## Departures

- The plan first said that an ACP record with a machine block counts as found. The shipped rows have that block, so Amp would have counted as found. A create on a computer skips the check instead.
- The rule is in `defaultagent.ts` and not in `common.ts`, because it reads the host's context.
- A host with no default set can still reach `bot-chat` when every agent before it is missing its program.

## Verified

- `default-agent.test.ts` holds the rule and the entry points: create, form, plugin session, plugin chat and the sessionless `create_session`.
- `agent-acp-missing-program.test.ts` holds the check.
- Not held by a case of its own: the `create_session` of a running chat, which always has an agent to inherit.
