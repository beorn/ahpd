---
title: ask, choose and confirm call the cofold prompts
status: done
depends: [task-01-terminal-goes-to-050.md]
layer: "server"
refs:
  - "[code://packages/server/src/ask.ts#L1-L131](../../../../packages/server/src/ask.ts#L1-L131) - the readline questions this task replaces"
  - "[code://packages/server/src/commands/configure.ts#L253-L300](../../../../packages/server/src/commands/configure.ts#L253-L300) - the first questions, which must keep their defaults"
  - npm://@cofold/terminal@0.5.0 - `createPrompts`, `select`, `text`, `confirm`, `NO_TERMINAL`, `PromptCancelled`
---

## Objective

`ask`, `choose` and `confirm` draw their question with cofold's prompts, and keep their signatures, their defaults and their refusals.

## Files

- `UPDATE: packages/server/src/ask.ts` - `ask` calls `text` with the current value as `initial`; `choose` calls `select` with the current value under the cursor; `confirm` calls `confirm` with the default answer as `initial`; `answering` and `here` stay as they are.
- `UPDATE: packages/server/src/commands/configure.ts` - only the import line, if `answering` moves; no question changes.

## Steps

1. Read `packages/server/src/ask.ts` and note the `Term` type and the `answering` check.
2. Read the cofold type file `node_modules/@cofold/terminal/dist/types/prompts.d.ts` and confirm the option names for `text`, `select` and `confirm`.
3. Add a helper in `ask.ts` that builds `createPrompts({ input: term.input, output: term.output })` for a `Term`.
4. Make `ask` call `text` with the current value in the message, and return the current value when the answer is empty.
5. Rewrite `choose` to call `select` with the options, and the current value under the cursor.
6. Rewrite `confirm` to call `confirm` with `initial` set to `yes`.
7. Map cofold's `PromptCancelled` to the error `ask.ts` raises today for a closed terminal, so `configure` stops in the same place.
8. Keep `reader`, `answered` and the readline import only if a caller still needs them; otherwise delete them.
9. Run `pnpm typecheck`.

## Validation

- `pnpm typecheck` exits 0.
- Calling `ask` on a stream without `isTTY` throws the same no-terminal message as before.
- An empty answer to `ask` returns the current value.
