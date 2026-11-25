---
title: create_session takes model options
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L595-L615](../../../../packages/sdk/src/tools/session.ts#L595-L615) - the definition"
  - "[code://packages/sdk/src/tools/session.ts#L502](../../../../packages/sdk/src/tools/session.ts#L502) - how a model is found and refused"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `resolveCreatedModelSelection`, `sessionServerTools.ts` L1028-L1083
---

## Objective

While `sessionModelOptions` is not `off`, `create_session` offers `reasoningEffort` and `contextTier`.
It checks each against the chosen model's `configSchema`, and starts the new chat with them in its model's `config`.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:595-615` - the two properties, added to the schema only while the key allows them.
- `UPDATE: packages/sdk/src/tools/session.ts` - the checks of `resolveCreatedModelSelection`, with its messages.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the option cases.

## Steps

1. Read `sessionModelOptions` from the root config on each call, as VS Code reads it.
2. Add `reasoningEffort` and `contextTier` to the schema only while it is `inline` or `tool`, with VS Code's descriptions.
3. Port VS Code's checks of the model: one to inherit or name, and one the catalog holds.
4. Port VS Code's checks of the option: in the model's `configSchema`, and not `readOnly`.
5. Start from the calling chat's model values when the call omits `model` or names that chat's model.
6. Put the checked values on the new chat's `ModelSelection.config`.

## Validation

- `packages/sdk/test/sessiontools.test.ts` - with `off`, the schema has neither option and a sent one is not read.
- The same file - a supported `reasoningEffort` reaches the new chat's model config.
- The same file - the host refuses an unsupported `reasoningEffort` and any `contextTier` in VS Code's words.
- The sdk vitest suite passes.

## Resume

`tools/modeloptions.ts` reads `sessionModelOptions`, the two options and VS Code's checks, in VS Code's words. `vscode/modelconfiguration.ts` vendors the keys, the tiers, the aliases and `withExplicitModelConfiguration`. `create_session` offers the options in `forSession`, and passes them to `create` and `createChat`. The host resolves the selection in `tooling.ts`, from the calling chat's whole selection, and starts the first turn on it. A tool now sees the models with their `configSchema`. The cases are `modeloptions.test.ts` and *the model options behind sessionModelOptions* in `sessiontools.test.ts`.
