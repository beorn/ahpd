---
title: the terminal package goes to 0.5.0
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/package.json#L52](../../../../packages/server/package.json#L52) - the pin, `^0.4.0`, that moves to `^0.5.0`"
  - npm://@cofold/terminal@0.5.0 - the release with the prompts
---

## Objective

`@ahpd/server` depends on `@cofold/terminal` 0.5.0, so the next task can import the prompts.

## Files

- `UPDATE: packages/server/package.json` - the `@cofold/terminal` range moves from `^0.4.0` to `^0.5.0`.
- `UPDATE: pnpm-lock.yaml` - the lock file records 0.5.0 for the server.

## Steps

1. Change the `@cofold/terminal` range in `packages/server/package.json` to `^0.5.0`.
2. Run `pnpm install` in this worktree.
3. Run `pnpm typecheck` and confirm it passes.
4. Confirm that `node -p "require('@cofold/terminal/package.json').version"` in `packages/server` prints `0.5.0`.

## Validation

- `pnpm typecheck` exits 0.
- The installed `@cofold/terminal` in `packages/server/node_modules` is 0.5.0.
