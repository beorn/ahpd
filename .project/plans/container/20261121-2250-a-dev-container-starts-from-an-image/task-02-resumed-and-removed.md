---
title: An environment is resumed and removed
status: done
depends: [task-01-a-container-starts-from-an-image.md]
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/devContainerAgentHostService.ts#L314-L325` and `#L1295-L1325`
---

## Objective

A stopped container waits for `resume: true`, and `vscode/devContainers/removeEnvironment` removes an environment with its container and volumes.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts` - `resume` on both connects, and `removeEnvironment` on the port.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - `removeEnvironment`, and `resume` read on both connects.
- `UPDATE: packages/sdk/src/host/gate.ts` - `container:remove` for the method.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `UPDATE: packages/computer/src/devcontainer.ts` - the suspended and removed sources.
- `UPDATE: packages/computer/src/environments.ts` - the removal of the container and its volumes.
- `UPDATE: packages/computer/test/environments.test.ts` - resume and removal.

## Steps

1. Mark a source as suspended on `stop`, and clear the mark on a connect with `resume: true`.
2. Refuse a connect to a suspended source without `resume`, in VS Code's words.
3. Refuse a removal by anyone but the environment's owner.
4. Mark the environment as removed, then close every relay to it.
5. Remove its container, its workspace volume and its state volume.
6. Clear the removed mark when the removal fails.
7. Refuse a connect to a removed environment, in VS Code's words.

## Validation

- `packages/computer/test/environments.test.ts` - resume, a refusal, and a removal with a relay open.
- The sdk and computer vitest suites pass, one at a time.

## Resume
