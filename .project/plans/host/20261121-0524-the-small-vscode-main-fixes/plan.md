---
title: The small VS Code main fixes
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires: []
refs:
  - git://b61f8a2f6 - main when the plan was made, and the last commit before the brief is used
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, the facts this plan builds, section *Small fixes*
  - "[code://packages/sdk/src/access/permissionrules.ts#L73-L87](../../../../packages/sdk/src/access/permissionrules.ts#L73-L87) - `matchesPermissionRule`, with no `Mcp` case"
  - "[code://packages/sdk/src/host/permissions.ts#L78-L85](../../../../packages/sdk/src/host/permissions.ts#L78-L85) - `mcpServerOf`, the server a call's tool belongs to"
  - "[code://packages/sdk/src/host/spawn.ts#L626-L632](../../../../packages/sdk/src/host/spawn.ts#L626-L632) - the request the approval chain reads"
  - "[code://packages/sdk/src/sessions/changes.ts#L1291-L1299](../../../../packages/sdk/src/sessions/changes.ts#L1291-L1299) - Create PR pushes a branch with no upstream to `origin`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L283-L288](../../../../packages/sdk/src/vscoderootconfig.ts#L283-L288) - `migrateLegacyCopilotCliEnabled`, which VS Code main no longer has"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L492-L499](../../../../packages/sdk/src/vscoderootconfig.ts#L492-L499) - `clientOwnedApprovalRootConfigKeys`"
  - git://github.com/microsoft/vscode@0ad0170ab342 - the `Mcp` permission rules
  - git://github.com/microsoft/vscode@1808c5c2a55e - the push remote of Create PR
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agentHostSchema.ts`, the root keys
---

## Goal

ahpd matches three small behaviours of VS Code main.
A permission rule `Mcp`, `Mcp(<server>)` or `Mcp(<server>/<tool>)` matches a call of that MCP server or tool.
Create PR pushes a branch with no upstream to the remote VS Code chooses.
The root schema declares VS Code main's ten new keys and drops `migrateLegacyCopilotCliEnabled`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Build the small fixes now | Softov, 2026-11-21, chose "Small fixes now" | 01, 02, 03 |
| A request carries `mcpServerName` and `mcpToolName`, as VS Code's `IPermissionRequest` does | (defaulted: VS Code `0ad0170ab342`) | 01 |
| `mcpServerName` is the call's server by `mcpServerOf`, and `mcpToolName` the tool name less its `mcp__<server>__` prefix | (defaulted: the names `alwaysAsks` reads) | 01 |
| A server name with a `/` matches no `Mcp(<server>)` rule | (defaulted: VS Code `common/permissionRules.ts`) | 01 |
| The push remote is the branch's push remote, then the GitHub remote, then `origin`, then the only remote | (defaulted: VS Code `1808c5c2a55e`) | 02 |
| The PR's head names the owner of the remote pushed to, where it differs from the base repository | (defaulted: VS Code `1808c5c2a55e`) | 02 |
| Each new key copies VS Code's type, title, description, enum and default | (defaulted: sibling keys in `vscoderootconfig.ts`) | 03 |
| A key is declared only; no behaviour reads it in this plan | (defaulted: `keepAwakeWhileWorking`, `sessionModelOptions` and `chatResources` get their behaviour in later plans) | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An Mcp rule names a server or a tool](task-01-an-mcp-rule-names-a-server-or-a-tool.md) | done | - |
| [02 - Create PR pushes to the right remote](task-02-create-pr-pushes-to-the-right-remote.md) | done | - |
| [03 - The root schema has the new keys](task-03-the-root-schema-has-the-new-keys.md) | done | - |

## Risks and tradeoffs

- An `Mcp` rule in `allow` now allows calls that asked before. That is the rule's meaning in VS Code.
- A repository with two remotes and no `origin` pushed to `origin` and failed. It now pushes to the GitHub remote.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [ ] A test: `Mcp`, `Mcp(<server>)` and `Mcp(<server>/<tool>)` match, and another server does not.
- [ ] A test: a branch with no upstream pushes to the GitHub remote when there is no `origin`.
- [ ] A test: the root schema holds the ten keys and not `migrateLegacyCopilotCliEnabled`.
- [ ] The gates pass: typecheck, boundary, schema and the sdk suite.
