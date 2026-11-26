---
title: A plugin registers an operation
status: todo
depends: []
layer: "sdk"
---

## Objective

A plugin registers an operation onto kinds of a list, or onto the list, and the host checks it.

## Files

- `UPDATE: packages/sdk/src/types/lists.ts` - `ListOperation`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerOperation` on `PluginHost`, and `operations` on `Contribution`.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - `checkListOperation`, with `checkKindOperations` for the operation.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the registration.
- `UPDATE: packages/sdk/test/plugin-lists.test.ts` - the cases.

## Steps

1. Write `ListOperation` with `channel`, an optional `kinds`, `operation` and `invoke`.
2. Check the operation with the checks of a kind's own operation.
3. Add `registerOperation` under the contract key `operations`.
4. Record it in the plugin's contribution.

## Validation

- The plugin host records a complete registration, and refuses an empty one.
- The plugin host refuses an id of create, update or remove.

## Resume
