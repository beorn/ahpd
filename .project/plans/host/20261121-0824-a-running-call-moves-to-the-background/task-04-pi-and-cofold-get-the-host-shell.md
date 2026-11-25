---
title: pi and cofold get the host shell by default
status: done
depends: [task-03-the-shell-tool-moves-a-sync-command.md]
layer: "sdk, agent-cofold"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L552-L555](../../../../packages/sdk/src/host/tooling.ts#L552-L555) - `shellToolsFor`, the one switch today"
  - "[code://packages/sdk/src/host/tooling.ts#L585-L591](../../../../packages/sdk/src/host/tooling.ts#L585-L591) - `contributingTo`, which takes the provider"
  - "[code://packages/sdk/src/host/tooling.ts#L691](../../../../packages/sdk/src/host/tooling.ts#L691) - `toolDefinitions`, which passes no provider"
  - "[code://packages/agent-cofold/src/turnagent.ts#L379-L382](../../../../packages/agent-cofold/src/turnagent.ts#L379-L382) - where cofold's capabilities are built"
  - "[code://packages/agent-cofold/src/capabilities.ts#L41-L45](../../../../packages/agent-cofold/src/capabilities.ts#L41-L45) - `capabilitiesOf`"
---

## Objective

A pi or cofold session gets the host shell tool unless the root config sets `enableCustomTerminalTool: false`.
Other providers keep today's rule.
A cofold session that has the host `bash` has no `shell_exec`.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:552-555` - `shellToolsFor(provider)`: on for `pi` and `cofold` unless the value is `false`, else today's rule.
- `UPDATE: packages/sdk/src/host/tooling.ts:585-591` - pass the provider to `shellToolsFor`.
- `UPDATE: packages/sdk/src/host/tooling.ts:691` - pass the session's provider to `contributingTo`, so the wire list agrees with what is bound.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:379-382` - turn `shell` off in the tools config when a bound host tool is `bash` with `overridesBuiltInTool`.
- `CREATE: packages/sdk/test/shell-providers.test.ts` - the switch per provider.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - a session with the marked host `bash` has no `shell_exec`.

## Steps

1. Give `shellToolsFor` the provider, and keep `win32` and the missing terminal store as refusals for every provider.
2. Read `enableCustomTerminalTool` as three values: `true`, `false`, and unset.
3. Pass the provider at both callers; read it from the session where `toolDefinitions` has only the URI.
4. In cofold, compute `shell: false` when the host `bash` overrides the built-in, and keep the other capabilities.
5. Write the tests.

## Validation

- `packages/sdk/test/shell-providers.test.ts` holds these cases:
  - pi and cofold get `bash` with the value unset.
  - No provider gets it with `false`.
  - Claude gets it only with `true`.
  - No provider gets it on `win32`.
- `packages/agent-cofold/test/agent-cofold-tools.test.ts`: the offered tools hold `bash` and not `shell_exec`; an unmarked `bash` keeps `shell_exec`.
- `npx vitest run packages/sdk/test/shell-providers.test.ts packages/agent-cofold packages/agent-pi` passes.

## Resume

Done on 2026-11-21.

- `contributingTo` reads the provider through `providerOf`, which falls back to the session's own agent. `toolDefinitions` needed no change.
- Not checked: whether VS Code pushes `enableCustomTerminalTool: false` on its own. If it does, a VS Code window turns the host shell off for pi and cofold too.

