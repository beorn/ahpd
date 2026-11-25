---
title: The sandbox schema names every value
domain: container
status: built
priority: medium
created: 2026-11-15
revalidated: 2026-11-15
refs:
  - "[code://packages/computer/src/sandbox.ts#L16-L86](../../../../packages/computer/src/sandbox.ts#L16-L86) - `FILE_SYSTEM_PROPERTIES` and `SANDBOX_PROPERTY`, the root `sandbox` schema"
  - "[code://packages/sdk/src/types/sandbox.ts#L54-L65](../../../../packages/sdk/src/types/sandbox.ts#L54-L65) - `SandboxFileSystemSetting` and `SandboxMaskedCredentials`, the shapes the schema names"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1722](../../../../packages/sdk/src/plugins/plugins.ts#L1722) - `registerProviderConfiguration` reports each gap as a `root config` warning"
  - "[code://packages/sdk/src/plugins/schemagaps.ts](../../../../packages/sdk/src/plugins/schemagaps.ts) - the gap check, and why `{ type: 'object' }` alone is a gap"
  - "[code://packages/sdk/src/utils/configvalues.ts#L37-L49](../../../../packages/sdk/src/utils/configvalues.ts#L37-L49) - `accepts` checks only the top type and enum, so a stored value is kept"
  - "[code://packages/server/test/schema-gaps.test.ts#L154-L177](../../../../packages/server/test/schema-gaps.test.ts#L154-L177) - `walkedOf` walks no provider configuration"
  - https://github.com/microsoft/vscode/blob/07225c7a78b1/src/vs/platform/agentHost/common/sandboxConfigSchema.ts - VS Code's schema with the `envVars` entry shape
  - https://github.com/microsoft/vscode/commit/07225c7a78b1 - "chat: expose sandbox credential masking in settings (#346423)", 2026-11-06
---

## Goal

The computer plugin page shows five warnings at each start, one for each object in the root `sandbox` setting that names no value.
A client draws such an object as "No parameters defined.", and a save there can destroy what was written.
After this plan, the schema names every value, the warnings go, and a test fails when a provider configuration has a gap again.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "object with no properties" packages` - the line comes from `schemaGaps` through `gapLine`.
- `rg "registerProviderConfiguration\(" packages/*/src` - only the computer plugin registers one.
- `rg "envVars|fileSystem\.|advanced.runtime" packages/*/src` - only `sandboxSettingsOf` reads the values, and it reads them as `SandboxConfigValue`.
- `git diff 6b68d3fe7dd7 1564f100807a -- src/vs/platform/agentHost/common/sandboxConfigSchema.ts` in VS Code - only `envVars` changed: an `additionalProperties` entry shape and new description words.

### Runtime path

```
computer apply -> registerProviderConfiguration(sandboxConfiguration) -> schemaGaps per root key -> alert -> plugin page Alerts
```

### Gaps

- `credentials.envVars`, `fileSystem.linux`, `fileSystem.mac`, `fileSystem.windows` and `advanced.runtime` are `{ type: 'object' }` with no value schema.
- `packages/server/test/schema-gaps.test.ts` walks no `providerConfigurations`, so the gap merged.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the five gaps, without a large change to how the sandbox works | "I accept the suggestion if this does not affect to much the working", 2026-11-15 | 01 |
| `advanced.runtime` is an object whose values are any JSON: `additionalProperties: {}` | "Key list, JSON values", 2026-11-15 | 01 |
| `credentials.envVars` takes VS Code's entry shape and description from `07225c7a78b1` | `(defaulted: upstream parity)` | 01 |
| `fileSystem.linux`, `.mac` and `.windows` name `allowRead`, `allowWrite`, `denyRead` and `denyWrite`, each a list of paths | `(defaulted: the shape of SandboxFileSystemSetting)` | 01 |
| The three platforms share one properties object | `(defaulted: one shape, written once)` | 01 |
| The gap test walks each provider configuration's properties as `root config <key>` | `(defaulted: the test that would have caught it)` | 02 |

## Proposed architecture

- **Data flow** - no change: a client pushes the same `sandbox` value, and `sandboxSettingsOf` reads it as before.
- **State flow** - a stored `sandbox` value is kept at a restart, because `accepts` checks only the top type.
- **Layer responsibilities** - computer: the schema · server test: the walk.
- **Source-of-truth files** - [`code://packages/computer/src/sandbox.ts`](../../../../packages/computer/src/sandbox.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the-schema-names-every-value](task-01-the-schema-names-every-value.md) | done | - |
| [02 - the-gap-test-walks-root-config](task-02-the-gap-test-walks-root-config.md) | done | 01 |

## Risks and tradeoffs

- VS Code's JSON schema leaves the `fileSystem.*` lists out, and its TypeScript type names them - the schema follows the type.
- `required: ['injectHosts']` is in the schema, but no host check reads it - `accepts` checks only the top level, so no stored or pushed value is refused.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-15, uncommitted in the worktree.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** the plugin is built from this worktree, `/github/ahpd.worktrees/sandbox-schema-gaps`, on branch `computer/sandbox-schema-gaps`.

## Final verification checklist

- [x] `schemaGaps(SANDBOX_PROPERTY)` is empty.
- [x] `packages/server/test/schema-gaps.test.ts` fails with the five lines on the old schema, and passes on the new one.
- [x] `packages/computer/test/computer-sandbox.test.ts` passes.
- [x] `pnpm -s typecheck` and `pnpm -s boundary` pass.
- [ ] The plugin page shows no alert after a reimport.
