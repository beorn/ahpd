---
title: Every process ahpd starts gets the helper
status: done
depends: [task-01-the-host-asks-and-takes-the-answer.md]
layer: "sdk, agent-acp, agent-pi, agent-cofold"
refs:
  - "[code://packages/sdk/src/types/session.ts#L215](../../../../packages/sdk/src/types/session.ts#L215) - `env` for the agent's own process"
  - "[code://packages/agent-acp/src/connection.ts#L217](../../../../packages/agent-acp/src/connection.ts#L217) - where ACP spawns its agent"
  - "[code://packages/sdk/src/tools/shell.ts](../../../../packages/sdk/src/tools/shell.ts) - the terminal tool's shells"
---

## Objective

While `shellAuthentication` is on, every local agent process and every shell the host starts gets the helper's variables and its chat's token.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts` - the variables in each chat's `env`.
- `UPDATE: packages/sdk/src/tools/shell.ts` - the variables in the terminal tool's shells.
- `UPDATE: packages/sdk/src/machines/terminals.ts` - an `env` for a shell, which the tool's shells pass and a person's terminal does not.
- `UPDATE: packages/agent-acp/src/connection.ts` - the session's `env` reaches the spawned agent.
- `UPDATE: packages/agent-pi/src/agent.ts` - the session's `env` reaches pi's shell.
- `UPDATE: packages/agent-cofold/src/agent.ts` - the session's `env` reaches cofold's shell.
- `CREATE: packages/sdk/test/shell-authentication-env.test.ts` - which processes get the variables.

## Steps

1. Set `SUDO_ASKPASS`, `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, `GIT_ASKPASS` and the token in each local chat's `env`.
2. Set the same variables in the terminal tool's shells, and leave out a terminal a person opens.
3. Keep a `GIT_ASKPASS` or `SSH_ASKPASS` the environment already sets.
4. Check each agent package passes `env` to the process that runs commands, and fix the ones that do not.
5. Leave out a chat or a shell on a machine.
6. Remove the variables from new processes when the setting goes off.

## Validation

- `packages/sdk/test/shell-authentication-env.test.ts` - the variables on and off, and none on a machine.
- The same file - none in a person's terminal, and a helper already set kept.
- The sdk, acp, pi and cofold vitest suites pass, one at a time.

## Resume
