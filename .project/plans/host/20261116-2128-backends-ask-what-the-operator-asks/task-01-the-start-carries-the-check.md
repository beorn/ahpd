---
title: The start carries the check
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/agent.ts#L270](../../../../packages/sdk/src/types/agent.ts#L270) - `Start`"
  - "[code://packages/sdk/src/host/permissions.ts#L105-L124](../../../../packages/sdk/src/host/permissions.ts#L105-L124) - `alwaysAsks`"
  - "[code://packages/sdk/src/host/spawn.ts#L1305](../../../../packages/sdk/src/host/spawn.ts#L1305) - where `Start` is built"
---

## Objective

Under `managedRules: checked`, each backend's `Start` carries `alwaysAsks(toolName, contributor?)`, which answers true for a tool the operator sets `false`.
Under `handed`, `Start` has no such field.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:270` - `alwaysAsks?(toolName: string, contributor?: unknown): boolean` on `Start`, with its doc comment.
- `UPDATE: packages/sdk/src/host/spawn.ts:1305` - the host sets it from `alwaysAsks` under `checked`.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the field's cases.

## Steps

1. Add `alwaysAsks` to `Start`, and say that absent means the backend checks nothing.
2. Set the field where the host builds `Start`, only when `options.managedRules` is not `handed`.
3. Answer it with `alwaysAsks(options.eligibleForAutoApproval, toolName, ...)`, with the session's bound host tools and customizations.
4. Read the bound tools at each call, so a tool bound later in the session counts.

## Validation

- `host-permissions.test.ts`: a backend's `Start.alwaysAsks` answers true for `host/list_bash` set `false`, and false for a tool the rule does not name.
- `host-permissions.test.ts`: under `managedRules: handed`, `Start.alwaysAsks` is absent.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- `Start.alwaysAsks` reads the bound tools of the session's default chat at each call.
- One case in `host-permissions.test.ts` covers both values of `managedRules`.
