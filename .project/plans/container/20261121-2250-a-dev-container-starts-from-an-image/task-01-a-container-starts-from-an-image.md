---
title: A container starts from an image in a volume
status: done
depends: []
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/devContainerEnvironments.ts`, `prepareDevContainerEnvironment`
---

## Objective

`vscode/devContainers/connectEnvironment` starts a container from an allowed image, with its workspace in the environment's Docker volume, and relays its nested host as `connect` does.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts` - `connectEnvironment` on the port, and its options.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the method.
- `UPDATE: packages/sdk/src/host/handshake.ts` - `vscode.devContainerEnvironments` in `_meta`.
- `UPDATE: packages/sdk/src/host/gate.ts` - `container:connect` for the method.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/computer/src/environments.ts` - the volume, its labels, the state volume's name, and the configuration for the image.
- `UPDATE: packages/computer/src/devcontainer.ts` - `connectEnvironment` through the same `up` and relay.
- `CREATE: packages/computer/test/environments.test.ts` - the volume and the configuration.

## Steps

1. Refuse a bad environment id, and an image off the list.
2. Find the environment's volume by its labels, or make one with the first free name.
3. Skip a name whose state volume exists.
4. Make the workspace folder in the volume with `docker run --rm`, and give it to the remote user.
5. Write a configuration for the image, with the volume at `/workspaces` and `updateRemoteUserUID: false`.
6. Add the two id labels, and keep the configuration in an owner-only cache folder.
7. Run `up` with that configuration, and start the nested host as `connect` does.
8. Answer `connect`'s result, with `/workspaces/<volume>` as the remote folder.
9. Advertise `vscode.devContainerEnvironments` while containers are ready.

## Validation

- `packages/computer/test/environments.test.ts` - a new volume, a reused one, and the refusals.
- The sdk and computer vitest suites pass, one at a time.

## Resume
