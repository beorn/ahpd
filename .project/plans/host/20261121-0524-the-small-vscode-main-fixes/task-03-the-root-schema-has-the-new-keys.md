---
title: The root schema has the new keys
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/vscoderootconfig.ts](../../../../packages/sdk/src/vscoderootconfig.ts) - the root keys copied from VS Code"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agentHostSchema.ts` `platformRootSchema`
---

## Objective

The root schema declares `keepAwakeWhileWorking`, `sessionModelOptions`, `chatResources`, `hooksEnabled`, `mcpSkillsEnabled`, `mcpSkillsServerApprovals`, `extensionPermissionApprovals`, `mcpGalleryServiceUrl`, `browserUseEnabled` and `assistedApprovalInstructions`, as VS Code main does.
`migrateLegacyCopilotCliEnabled` is gone.

## Files

- `UPDATE: packages/sdk/src/vscoderootconfig.ts` - the ten keys, each with the comment that names its line in VS Code.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the keys are declared.

## Steps

1. Copy each key's type, title, description, enum and default from `agentHostSchema.ts` at `ddbdd50a9ed1`.
2. Remove `migrateLegacyCopilotCliEnabled`.
3. Add `assistedApprovalInstructions` to `clientOwnedApprovalRootConfigKeys` where VS Code has it there.

## Validation

- `packages/sdk/test/root-config.test.ts` - the ten keys are in the schema, and the old one is not.
- The sdk vitest suite passes.

## Resume

The ten keys are in `vscoderootconfig.ts`, each copied from `agentHostSchema.ts` at `ddbdd50a9ed1`, with its line in a comment. `migrateLegacyCopilotCliEnabled` is gone, and `assistedApprovalInstructions` joins `clientOwnedApprovalRootConfigKeys`, as in VS Code main. `root-config.test.ts` checks the ten keys and the dropped one. The 1.145 window's patch in `wire.test.ts` still holds the dropped key. It now counts among the keys VS Code dropped, which a host keeps as pushed. The sdk suite passes, 4968 cases.
