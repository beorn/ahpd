---
title: The computer plugin runs on the fork
status: done
depends: [task-02-the-forks-first-release.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/sandbox.ts#L165](../../../../packages/computer/src/sandbox.ts#L165) - the CLI's path"
  - "[code://packages/computer/src/sandbox.ts#L292](../../../../packages/computer/src/sandbox.ts#L292) - `SandboxManager`"
---

## Objective

The computer plugin depends on `@ahpio/sandbox-runtime` at one exact version, and finds its CLI and `SandboxManager` under that name.

## Files

- `UPDATE: packages/computer/package.json` - the dependency, and `engines.node` `>=22.12.0`.
- `UPDATE: packages/computer/src/sandbox.ts` - the package name for the CLI and `SandboxManager`.
- `UPDATE: pnpm-lock.yaml` - the new dependency.
- `CREATE: packages/computer/test/sandbox-runtime-fork.test.ts` - the whole network allowed, and the filesystem rules kept.

## Steps

1. Replace `@vscode/sandbox-runtime` with `@ahpio/sandbox-runtime` at `0.0.83-rc.0`.
2. Resolve the CLI and `SandboxManager` under the new name.
3. Raise the plugin's Node floor to `>=22.12.0`.
4. Check that settings with `network.enabled: false` reach an unlisted host and keep the filesystem rules.
5. Run `pnpm audit`, and check it no longer reports the zod advisory.

## Validation

- `packages/computer/test/sandbox-runtime-fork.test.ts` - the gate, end to end, on Linux.
- The computer vitest suite passes, and the computer suite on Windows CI.

## Resume

Done 2026-11-22, as [implemented.md](implemented.md) says.
