---
title: An instance comes and goes
status: todo
depends: []
layer: "sdk"
---

## Objective

A kind of an instance list adds and removes instances at run time, and the host keeps them.

## Files

- `UPDATE: packages/sdk/src/types/lists.ts` - `ListInstance`, and `addInstance` and `removeInstance` on `ListKindHandle`.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - `checkList` takes `instances: true`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the handle keeps the instances on the served kind.
- `UPDATE: packages/sdk/test/plugin-lists.test.ts` - the cases.

## Steps

1. Add `ListInstance` with `id`, `title` and an optional `owner`.
2. Let `checkList` take `instances: true`, and keep refusing `page`.
3. Add `addInstance` and `removeInstance` to the handle.
4. Refuse `addInstance` on a list with no `instances`, and an instance id with a slash.
5. Keep the instances on the served kind, and tell the list channel when they change.

## Validation

- A kind adds two instances and removes one, and the served kind holds one.
- An `addInstance` on a list with no `instances` throws.

## Resume
