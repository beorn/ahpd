---
title: The docs say how a call moves to the background
status: done
depends: [task-02-the-move-method.md, task-03-the-shell-tool-moves-a-sync-command.md, task-04-pi-and-cofold-get-the-host-shell.md]
layer: "docs"
refs:
  - "[code://docs/sdk/AHP.md#L1144-L1146](../../../../docs/sdk/AHP.md#L1144-L1146) - `vscode/stopBackgroundWork`, beside which the new method goes"
  - "[code://docs/sdk/TERMINALS.md#L78](../../../../docs/sdk/TERMINALS.md#L78) - the shell tool's `mode` and its row"
---

## Objective

The docs name the method, its grant, the two `_meta` keys, the shell tool's move, and the new default for pi and cofold.

## Files

- `UPDATE: docs/sdk/AHP.md:1144-1146` - `x-ahpd/backgroundToolCall`, its answer, its grant, and the two `_meta` keys.
- `UPDATE: docs/sdk/TERMINALS.md:78` - a `sync` command that moves or is let go gets the `async` row and wake; pi and cofold get the tool by default.

## Steps

1. Add the method and the keys to `AHP.md`, beside `vscode/stopBackgroundWork`, and to its table of methods.
2. Add the move and the let-go behaviour to `TERMINALS.md`, after the `mode` paragraph.
3. Add the default for pi and cofold where `TERMINALS.md` names `enableCustomTerminalTool`.

## Validation

- `pnpm docs:build` passes.
- Each statement matches the tests of tasks 01 to 04.

## Resume

Done on 2026-11-21. `AHP.md` keeps its own hard wrap; `TERMINALS.md` keeps one paragraph per line.

