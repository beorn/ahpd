---
title: The session tools take model and display options - implemented
date: 2026-11-21
refs:
  - "[code://packages/sdk/src/tools/modeloptions.ts](../../../../packages/sdk/src/tools/modeloptions.ts) - the key, the two options and VS Code's checks"
  - "[code://packages/sdk/src/vscode/modelconfiguration.ts](../../../../packages/sdk/src/vscode/modelconfiguration.ts) - the vendored keys and `withExplicitModelConfiguration`"
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - `create_session` and `list_models`"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - the new chat's selection"
  - "[code://packages/sdk/src/tools/artifacts.ts](../../../../packages/sdk/src/tools/artifacts.ts) - `mode` and `modeRevision`"
---

`create_session` takes `reasoningEffort` and `contextTier` while `sessionModelOptions` is not `off`, and `list_models` lists each model's options at `tool`. `add_artifact_or_reference` takes `mode` while `chatResources` is on. With both keys at their defaults, the tools offer what they offered before.

## What was built

- [`code://packages/sdk/src/tools/modeloptions.ts`](../../../../packages/sdk/src/tools/modeloptions.ts) - `sessionModelOptionsOf`, `createdModelOptionsOf`, `resolveCreatedModelSelection` and `describeCreateSessionModelOptions`, with VS Code's messages.
- [`code://packages/sdk/src/vscode/modelconfiguration.ts`](../../../../packages/sdk/src/vscode/modelconfiguration.ts) - `contextSize`, the tiers, the aliases and the explicit source key.
- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - the two properties and the model description in `forSession`, `createSessionModelChoices`, and `options` in `list_models`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `create` and `createChat` resolve the selection and start the first turn on it. A tool sees the offered models with their `configSchema`, and the sessionless tools see the root config.
- [`code://packages/sdk/src/tools/artifacts.ts`](../../../../packages/sdk/src/tools/artifacts.ts) - `mode`, `modeRevision`, the update and promotion rules, and the schema with `mode`.

## Verified

- `modeloptions.test.ts`, `artifacttools.test.ts` and the new cases of `sessiontools.test.ts` pass.
- The sdk suite passes, 5100 cases, and the computer suite, 633 cases. Typecheck, boundary and i18n pass.

## Departures from the plan

- The calling chat's whole selection is inherited now, with its `config`, where the host kept only its id. VS Code inherits the whole selection whether or not the key is on.
- VS Code's refusal for a model router is not ported: ahpd has no model routers.
- `list_models` stays offered at every value of the key, as ahpd offered it before. VS Code offers it only at `tool`.
