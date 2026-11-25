---
title: The small VS Code main fixes - implemented
date: 2026-11-21
refs:
  - "[code://packages/sdk/src/access/permissionrules.ts](../../../../packages/sdk/src/access/permissionrules.ts) - the `Mcp` case"
  - "[code://packages/sdk/src/sessions/changes.ts](../../../../packages/sdk/src/sessions/changes.ts) - `pushRemoteOf`"
  - "[code://packages/sdk/src/vscoderootconfig.ts](../../../../packages/sdk/src/vscoderootconfig.ts) - the ten new root keys"
---

ahpd matches three small behaviours of VS Code main. A permission rule `Mcp`, `Mcp(<server>)` or `Mcp(<server>/<tool>)` matches an MCP call. Create PR pushes a branch with no upstream to the remote VS Code chooses. The root schema has VS Code main's ten new keys.

## What was built

- [`code://packages/sdk/src/access/permissionrules.ts`](../../../../packages/sdk/src/access/permissionrules.ts) - `mcpServerName` and `mcpToolName` on a request, and the `Mcp` case.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the request's server, by `mcpServerOf`, and its tool.
- [`code://packages/sdk/src/sessions/changes.ts`](../../../../packages/sdk/src/sessions/changes.ts) - `pushRemoteOf`, and a head of `<owner>:<branch>` for a remote of another owner.
- [`code://packages/sdk/src/repo/git.ts`](../../../../packages/sdk/src/repo/git.ts) - `githubRemoteOf`, shared by both callers.
- [`code://packages/sdk/src/vscoderootconfig.ts`](../../../../packages/sdk/src/vscoderootconfig.ts) - the ten keys, without `migrateLegacyCopilotCliEnabled`.

## Verified

- `permissionrules-mcp.test.ts`, `push-remote.test.ts`, `root-config.test.ts` and `wire.test.ts` pass.
- The sdk suite passes, 4968 cases. Typecheck and boundary pass.

## Departures from the plan

- The `Mcp` cases are a unit test of the matcher, and the push remote cases a test of `pushRemoteOf` on real repositories.
- The GitHub remote parser moved to an export of `repo/git.ts`, so that one copy serves both.

## Left for later

- The lookup of an open PR still names the head by the base owner, so a fork's open PR is not found before a create.
- No behaviour reads `keepAwakeWhileWorking`, `sessionModelOptions` or `chatResources` yet. The later plans of the brief `briefs/vscode-main-parity-after-ahp-1-1-0.md` (`git://8b6842e2c`) do.
