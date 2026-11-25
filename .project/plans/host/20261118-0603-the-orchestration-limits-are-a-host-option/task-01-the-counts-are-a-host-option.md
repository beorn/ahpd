---
title: The counts are a host option
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L56-L98](../../../../packages/sdk/src/host/tooling.ts#L56-L98) - the constants and `ORCHESTRATION_LIMITS`"
  - "[code://packages/sdk/src/types/host.ts#L908](../../../../packages/sdk/src/types/host.ts#L908) - `agentOrchestrationLimitsScope`, beside which the option goes"
  - "[code://docs/sdk/HOST.md#L95](../../../../docs/sdk/HOST.md#L95) - the options table"
---

## Objective

`createHost` takes `orchestrationLimits`, and the session tools refuse at those counts.
With no option, the counts are VS Code's 50, 50 and 100, as today.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:908` - `orchestrationLimits?: { sessions?: number; chats?: number; messages?: number }`, with its doc comment.
- `UPDATE: packages/sdk/src/host/tooling.ts:56-98` - `DEFAULT_ORCHESTRATION_LIMITS`, exported, and the maxima read from the option over it.
- `UPDATE: docs/sdk/HOST.md:95` - a row for `orchestrationLimits` beside `agentOrchestrationLimitsScope`.

## Steps

1. Export `DEFAULT_ORCHESTRATION_LIMITS = { sessions: 50, chats: 50, messages: 100 }` from `tooling.ts`, with VS Code's link.
2. Remove the `MAX_CREATED_*` and `MAX_SENT_MESSAGES` constants, so each number has one place.
3. Add `orchestrationLimits` to `HostOptions` beside `agentOrchestrationLimitsScope`.
4. In `tooling.ts`, read each maximum from the option, and fall back to `DEFAULT_ORCHESTRATION_LIMITS`.
5. Make `createHost` throw an error that names a key whose value is not a positive integer.
6. Keep the refusal sentence the same, with the maximum in force in place of the number.
7. Add the row to the options table of `docs/sdk/HOST.md`, and say that `ahpd` does not read it from `config.json`.

## Validation

- `pnpm typecheck` passes.
- The sdk suite passes, run alone as HANDOFF *Tests* says, before task 02 changes the cases.

## Resume

Built on 2026-11-18. The refusal's action words moved to `ORCHESTRATION_ACTIONS`, and `orchestrationMaxima` merges the option over the default when the tooling is made.

