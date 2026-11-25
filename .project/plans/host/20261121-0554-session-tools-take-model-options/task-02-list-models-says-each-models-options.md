---
title: list_models says each model's options
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L741](../../../../packages/sdk/src/tools/session.ts#L741) - `list_models`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `describeCreateSessionModelOptions`, `sessionServerTools.ts` L1092-L1110
---

## Objective

With `sessionModelOptions` at `tool`, `list_models` says the `reasoningEffort` values and `contextTier` each model accepts.
With `inline`, `create_session`'s description lists the models and their options.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:741` - each model's options in the answer.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the listing cases.

## Steps

1. Port `describeCreateSessionModelOptions`, with its rule that a `readOnly` option is not listed.
2. Add the options to each model of `list_models` with `tool`.
3. Add the listing to `create_session`'s description with `inline`.

## Validation

- `packages/sdk/test/sessiontools.test.ts` - `tool` lists a model's efforts with its default; `off` lists none.
- The sdk vitest suite passes.

## Resume

With `tool`, `list_models` gives each model an `options` string, and its description says so. `create_session`'s `model` description points at `list_models`. With `inline`, that description carries VS Code's catalog, *Available models by agent:*, from `createSessionModelChoices`. The cases are in `sessiontools.test.ts` and `modeloptions.test.ts`.
