---
title: A kind keeps its processes
status: done
depends: []
layer: "sdk"
---

## Objective

A kind answers the processes it started, as it answers its rows.

## Files

- `UPDATE: packages/sdk/src/types/lists.ts` - `ListProcess`, and `processes.list` and `processes.read` on `ListKind`.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - the checks.
- `UPDATE: packages/sdk/test/plugin-lists.test.ts` - the cases.

## Steps

1. Write `ListProcess` with `id`, `origin`, `lifecycle`, `progress` and `log`.
2. Add `processes.list` and `processes.read` to `ListKind`.
3. Require them on a kind with a long operation or of class `runtime`.

## Validation

- The plugin host refuses a kind with a long operation and no `processes`.

## Resume

Built on 2026-11-26.
