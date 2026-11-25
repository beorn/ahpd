---
title: Create PR pushes to the right remote
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L1291-L1299](../../../../packages/sdk/src/sessions/changes.ts#L1291-L1299) - the push"
  - git://github.com/microsoft/vscode@1808c5c2a55e - the order of remotes
---

## Objective

Create PR pushes a branch with no upstream to the remote VS Code chooses, and the PR names that remote's owner as its head owner.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts:1291-1299` - the remote is chosen in VS Code's order.
- `CREATE: packages/sdk/test/push-remote.test.ts` - the remote cases.
- `UPDATE: packages/sdk/src/repo/git.ts` - `githubRemoteOf`, the GitHub remote parser, exported for both callers.

## Steps

1. Read VS Code `1808c5c2a55e`, and record its order and its head owner rule in Resume.
2. Choose the remote: the branch's push remote, the GitHub remote with `origin` first, `origin`, then the only remote.
3. Name the head with the owner of that remote where it is not the base repository's owner.

## Validation

- `packages/sdk/test/push-remote.test.ts` - a repository with only `upstream` pushes there; one with `origin` pushes to `origin`.
- The sdk vitest suite passes.

## Resume

VS Code's order, from `1808c5c2a55e`: the branch's `pushRemote`, `remote.pushDefault`, `branch.<name>.remote`, then the first GitHub remote with `origin` first, then `origin`, then the only remote. `pushRemoteOf` in `changes.ts` follows it. The head names the owner of the remote pushed to, as `<owner>:<branch>`, where it is not the repository's owner. The GitHub remote parser moved out of a factory in `repo/git.ts` as `githubRemoteOf`, so both callers share it. The lookup of an open PR is left as it was. It still names the head by the base owner, so a fork's open PR is not found before a create.
