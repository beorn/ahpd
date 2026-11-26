---
title: A kind is runtime
status: todo
depends: []
layer: "sdk"
---

## Objective

A kind registers with `class: 'runtime'`, `start` and `stop`, and its live fields.

## Files

- `UPDATE: packages/sdk/src/types/lists.ts` - `start`, `stop` and the runtime report.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - `checkListKind` takes `runtime` with `start` and `stop`.
- `UPDATE: packages/sdk/test/plugin-lists.test.ts` - the cases.

## Steps

1. Add `start(row, report)` and `stop(row)` to `ListKind`.
2. Take `class: 'runtime'` when both are functions.
3. Read the fields marked `x-ahpd-live`.

## Validation

- The plugin host records a runtime kind with `start` and `stop`.
- The plugin host refuses a runtime kind without `stop`.

## Resume
