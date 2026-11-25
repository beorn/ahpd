---
title: The chat config reads the package
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/vscode/chatconfig.ts#L23-L63](../../../../packages/sdk/src/vscode/chatconfig.ts#L23-L63) - the types and the reducer vendored from VS Code"
  - "[code://packages/sdk/src/vscode/chatconfig.ts#L65-L100](../../../../packages/sdk/src/vscode/chatconfig.ts#L65-L100) - the checks this host keeps: `isChatConfigProperty`, `filterChatConfigValues`, `validateChatConfigWrite`"
  - "[code://packages/sdk/src/sessions/nested.ts#L1114](../../../../packages/sdk/src/sessions/nested.ts#L1114) - the vendored reducer in use"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1775](../../../../packages/sdk/src/host/sessionmethods.ts#L1775) - `createChat` reads `params.title`"
  - "[code://UPSTREAM.md#L17](../../../../UPSTREAM.md#L17) - a chat's config inherits its session's value, by Softov's choice"
---

## Objective

The per-chat config on main uses the package's `ChatConfigState`, `ChatConfigChangedAction` and `chatMutable`, and `createChat` reads the package's `CreateChatParams.title`.
A chat still inherits its session's value where it set none.

## Files

- `UPDATE: packages/sdk/src/vscode/chatconfig.ts:23-63` - the vendored types and `reduceChatConfigChanged` give way to the package's.
- `UPDATE: packages/sdk/src/sessions/nested.ts:52-53` - the imports read the package.
- `UPDATE: packages/sdk/src/sessions/nested.ts:1114` - the package's chat reducer applies `chat/configChanged`.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the imports read the package.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - the imports read the package.
- `UPDATE: packages/sdk/src/host/snapshots.ts:8-9` - the imports read the package.
- `UPDATE: packages/sdk/src/host/tooling.ts:23-24` - the imports read the package.
- `UPDATE: packages/sdk/src/host.ts` - the imports read the package.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1775` - `params` is typed as `CreateChatParams`, where it is not yet.

## Steps

1. Replace each type of `vscode/chatconfig.ts` with the package's type of the same name.
2. Replace `reduceChatConfigChanged` with the package's chat reducer, and keep a test that shows both give the same state.
3. Keep `isChatConfigProperty`, `filterChatConfigValues` and `validateChatConfigWrite`, which the package has no copy of.
4. Keep the inheritance of a session's value, and name it in a comment that cites `UPSTREAM.md` Pass 8.
5. Move the three checks to `host/chatconfig.ts`, and delete `vscode/chatconfig.ts`.
6. Type `createChat`'s `params.title` from `CreateChatParams`.

## Validation

- The per-chat config tests on main pass unchanged.
- `packages/sdk/test/conformance.test.ts` - `chat/configChanged` replays through the package's reducer.
- `pnpm typecheck` and the sdk vitest suite pass.

## Resume

The vendored types and reducer are gone. The checks are in `packages/sdk/src/host/chatconfig.ts`, and `host.ts` and `nested.ts` apply `chat/configChanged` through the package's chat reducer, whose case is the same. The 1.1.0 package registers `chat/configChanged` at `1.1.0`, so the host's version filter held it back from a client on `0.9.0` or `1.0.0`. That broke two sandbox cases. The filter now lets it through, as VS Code's host does. `wire.test.ts` no longer lists `ChatState.config` and `chatMutable` as undeclared. Departure: `createChat` keeps its untyped `params`, as every session method reads them; `params.title` was read already. For task 06: `docs/sdk/AHP.md` L102 and L1198 still call `chatMutable` undeclared.
