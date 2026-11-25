---
title: the tool table and the tools 0.4.2 bump
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/tools.ts#L16-L60](../../../../packages/agent-cofold/src/tools.ts#L16-L60) - the hand-written table of cofold's tools and the fields they act on"
  - npm://@cofold/tools@0.4.2 - each tool declares `subject`
---

## Objective

ahpd reads what each cofold tool acts on from the tool, not from its own table.

## Files

- `UPDATE: packages/agent-cofold/package.json` - `@cofold/tools` moves from `^0.4.1` to `^0.4.2`.
- `UPDATE: pnpm-workspace.yaml` - add `@cofold/tools@0.4.2` to `minimumReleaseAgeExclude`.
- `UPDATE: packages/agent-cofold/src/tools.ts` - remove the table rows that the declared `subject` replaces.

## Steps

1. Bump `@cofold/tools` in `packages/agent-cofold/package.json` to `^0.4.2`.
2. Add `@cofold/tools@0.4.2` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
3. Run `pnpm install` in the worktree.
4. Read the table in `tools.ts` and list each row against the tool's `subject` in the 0.4.2 package.
5. Remove each row the declared `subject` covers, and keep any row it does not.
6. Run `pnpm exec vitest run packages/agent-cofold` and `pnpm typecheck`.

## Validation

- Both commands exit 0.
- Each approval prompt for a file tool names the same path as before, in the agent-cofold tests.

## Result

`@cofold/tools` is `^0.4.2`, with `0.4.2` in `minimumReleaseAgeExclude`. The table in `tools.ts` stays. `subject` was already in 0.4.1, and it is a display string. It is a workspace-relative path for a file tool, the glob for `list_files` and `search_files`, and the command for `shell_exec`. It names no permission kind and no absolute path, so it cannot replace a row without changing the approval prompt. 0.4.2's one change is the memory index reminder in `memory_write`.
