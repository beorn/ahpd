---
title: the installs and the listeners are asked
status: done
depends: [task-05-acp-backend-and-main-plugins.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/configure.ts#L268-L290](../../../../packages/server/src/commands/configure.ts#L268-L290) - `listenerQuestion`, the switch and the port for the HTTP API and the model gateway"
  - "[code://packages/server/src/commands/configure.ts#L370-L440](../../../../packages/server/src/commands/configure.ts#L370-L440) - the found agents, the absent agents to install, and the confirm before any install line runs"
  - "[code://packages/sdk/src/machines/agents.ts](../../../../packages/sdk/src/machines/agents.ts) - `installLine`, the line for each agent on this system"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the tests of both questions, at the end of the file"
---

## Objective

An ACP agent this machine does not have is asked as an install, and nothing is installed unless the person ticks it and confirms. `httpApi` and `modelApi` get a switch and a port, so the configure flow covers them.

## Files

- `UPDATE: packages/server/src/commands/configure.ts` - the absent agents become a multiselect with their install lines as hints, one confirm runs the ticked lines, and `listenerQuestion` asks the switch and the port for each listener.
- `UPDATE: packages/server/test/server-configure.test.ts` - tests for the listeners, and for an install that is not run by Enter, run when ticked and confirmed, and declined.
- `UPDATE: packages/server/test/answers.ts` - a word can name a list of answers, given in order to each question it names.

## Steps

1. List each absent ACP agent that has an install line for this system, as a multiselect with nothing ticked.
2. Print the line of each ticked agent, and ask one confirm that defaults to No.
3. Run each ticked line through the shell only when the confirm is Yes, and write the record of each that exits 0.
4. Ask `Serve the HTTP API?` and `Serve the model gateway?` as switches that keep the file's answer on Enter.
5. Ask the port of each switched-on listener, or `own` for the daemon's own listener, with the current value as the answer Enter keeps.
6. Write `false` for a listener the file had and the person turns off, and leave the key out for a first run that says No.
7. Test each case with a keyed answer, and with a fake runner that records the `sh -c` calls.

## Validation

- `pnpm exec vitest run packages/server/test/server-configure.test.ts` passes.
- `pnpm typecheck` exits 0.
