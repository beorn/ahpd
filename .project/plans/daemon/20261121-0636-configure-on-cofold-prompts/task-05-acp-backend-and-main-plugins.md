---
title: ACP is a backend and the other list has the main plugins
status: done
depends: [task-04-the-plugin-questions-are-multiselects.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/configure.ts#L48-L90](../../../../packages/server/src/commands/configure.ts#L48-L90) - the backend and other-plugin lists, with their hints and first-run defaults"
  - "[code://packages/server/src/commands/configure.ts#L296-L345](../../../../packages/server/src/commands/configure.ts#L296-L345) - the backend question, and the found agents listed only once ACP is on"
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - `@ahpd/agent-acp`, the ACP runtime"
---

## Objective

ACP is offered in the backend list and is on by default, as Claude is. The other list offers the main base plugins, and only Web UI is on by default on a first run.

## Files

- `UPDATE: packages/server/src/commands/configure.ts` - ACP joins the backends with a default on; the other list gains Tasks, Computers, Push, Bots, Webhooks, Dev Tunnels and Activepieces, each with a hint; the found agents are printed after ACP is answered on.
- `UPDATE: packages/server/test/server-configure.test.ts` - the defaults include ACP; the other list is checked for each name.

## Steps

1. Add ACP to the backend list with the hint "Codex, Gemini, Copilot and the other ACP agents found on this machine".
2. Turn ACP on by default, next to Claude.
3. Add the seven plugins to the other list with a hint each, on by default only on a first run for Web UI.
4. Print the found agents when ACP is answered on, and not before the backend question.
5. Update the configure tests for the new defaults and run the server suite.

## Validation

- `pnpm typecheck` exits 0.
- The server suite passes.
- The first question shows ACP ticked, and the agent list does not print before it.
