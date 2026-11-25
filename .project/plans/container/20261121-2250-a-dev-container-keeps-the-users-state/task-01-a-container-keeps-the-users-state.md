---
title: A container keeps the user's state
status: done
depends: []
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/devContainerState.ts`, the volume and the links
---

## Objective

With `persistUserState`, a container gets a state volume, its state folders are linked into it, and each stage sends a `userState` notice.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts` - `persistUserState` on both connects, and `userState` on the sink.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - read the option, and send `vscode/devContainers/userState`.
- `CREATE: packages/computer/src/userstate.ts` - the state volume, its name and labels, and the folder links.
- `UPDATE: packages/computer/src/devcontainer.ts` - the stages in VS Code's order.
- `CREATE: packages/computer/test/userstate.test.ts` - the name, the labels, the links and the notices.

## Steps

1. Name the state volume with the image plan's `getDevContainerStateVolumeName`.
2. Make the volume with VS Code's labels, and mount it at `/workspaces` or the fallback target.
3. Run `up` with `--skip-post-create`.
4. Link the nested host's state folder and each agent's session folder into the volume.
5. Keep a folder that exists when the container was running before `up`.
6. Run the lifecycle commands after the link.
7. Link a container that has a state volume on every connect, with the option on or off.
8. Send one `userState` notice for each stage, with its outcome and counts.

## Validation

- `packages/computer/test/userstate.test.ts` - the volume's name and labels, the links, and the notices.
- The sdk and computer vitest suites pass, one at a time.

## Resume

The state volume, the links and the four notices are in `packages/computer/src/userstate.ts`, `devcontainer.ts` and `environments.ts`. `userstate.test.ts` covers the name, the labels, the mount target, the link script and the parser, the four notices, and a later connect with the setting off that still links.
