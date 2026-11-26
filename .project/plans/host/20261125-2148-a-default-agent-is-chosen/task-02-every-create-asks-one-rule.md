---
title: Every create asks one rule
status: done
depends:
  - task-01-an-agent-says-its-program-is-missing.md
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L2075-L2093](../../../../packages/sdk/src/host/tooling.ts#L2075-L2093) - the rule this task replaces, with the reason a plugin own agent is skipped"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1344-L1357](../../../../packages/sdk/src/host/sessionmethods.ts#L1344-L1357) - the order of the checks of a create"
  - "[code://packages/sdk/src/host/root.ts#L799](../../../../packages/sdk/src/host/root.ts#L799) - `rootFor`, where the choices are added for one connection"
---

## Objective

One function answers the agent of a create that names none. The root config key `defaultAgent` is its first answer.

## Files

- `CREATE: packages/sdk/src/host/defaultagent.ts` - `defaultAgentFor` and `ownerMay`.
- `UPDATE: packages/sdk/src/host/root.ts:425` - declare `defaultAgent` beside `defaultShell`.
- `UPDATE: packages/sdk/src/host/root.ts:799` - add the agents as choices of `defaultAgent` for the connection.
- `UPDATE: packages/sdk/src/host/tooling.ts` - the three creates call the function.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `createSession` and `resolveSessionConfig` call the function.
- `UPDATE: packages/sdk/src/host/automations.ts:839` - the start calls the function with the owner.
- `UPDATE: packages/sdk/test` - the cases of the rule and of each entry point.
- `UPDATE: docs/sdk/HOST.md` - the key and what it decides.
- `UPDATE: docs/sdk/AHP.md` - the key among those the host acts on.
- `UPDATE: docs/plugins/BOTS.md` - what a bot that names no agent runs on.
- `UPDATE: docs/updates/v0_16.md` - the entry and its Upgrading line.
- `UPDATE: .project/specs/agent-backends.md` - the scenario of a create with no agent.

## Steps

1. Write `defaultAgentFor(ctx, caller, by?)`, where `by` is the plugin that asks for a chat.
2. Return the `defaultAgent` value, unless it is empty or an agent of `by`.
3. Else list the agents that are on, that the caller may use, and that are not of `by`.
4. Return the first of the list with no `missingProgram`, else the first of the list.
5. Replace `ctx.first?.provider` in the five creates, and the `ownFront` search in `openChat`.
6. Keep the checks that follow, so a chosen agent gets the checks of a named one.
7. Declare `defaultAgent` as a string titled "Default Agent".
8. Add `enum` and `enumLabels` in `rootFor`, with an empty value labelled "First agent found".
9. Leave the choices out of the declared schema, so a start restores an agent that is not loaded yet.
10. Write the docs, the release notes and the spec.

## Validation

- One case for each entry point with the setting.
- One case for each entry point with no setting, where the program of the first agent is missing.
- One case each: the chosen agent off, paused, not served, not permitted, and of the asking plugin.
- A case: `resolveSessionConfig` and `createSession` with no provider answer the same agent.
- A case: a start restores a stored `defaultAgent` when its agent loads after the root.
- The sdk, bot, webhook and computer suites pass, one run at a time.

## Resume
