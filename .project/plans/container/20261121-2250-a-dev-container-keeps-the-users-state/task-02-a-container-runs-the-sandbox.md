---
title: A container runs the sandbox and says so
status: done
depends: [task-01-a-container-keeps-the-users-state.md]
layer: "sdk, computer"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/devContainerSandbox.ts`, the override and the check
---

## Objective

With `sandboxEnabled`, a container runs with the options the command sandbox needs, and the host says whether the running container supports it.

## Files

- `UPDATE: packages/sdk/src/types/containers.ts` - `sandboxEnabled` on both connects, `sandboxSupport` on the sink, and `sandboxSupported` on the result.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - read the option, and send `vscode/devContainers/sandboxSupport`.
- `CREATE: packages/computer/src/containersandbox.ts` - the override and the check of a running container.
- `UPDATE: packages/computer/src/devcontainer.ts` - the override on `up`, and the check after it.
- `CREATE: packages/computer/test/containersandbox.test.ts` - the override and the check.

## Steps

1. Write an override beside the configuration, with VS Code's security options and `/dev/net/tun`.
2. For a Docker Compose setup, write the options on its service, as VS Code's override does.
3. Run `up` with the override when the client asks for `sandboxEnabled`.
4. Read the running container with `docker inspect`, and decide as VS Code's `isDevContainerSandboxSupported` does.
5. Send `sandboxSupport` with the answer, and put it on the connect result.
6. Remove the override's folder when the connection ends.

## Validation

- `packages/computer/test/containersandbox.test.ts` - the override's arguments, and the check on sample `inspect` output.
- The sdk and computer vitest suites pass, one at a time.

## Resume

`packages/computer/src/containersandbox.ts` writes the override for a folder's definition and for a Compose service, and `devcontainer.ts` passes it to `up`, inspects the running container for every connect and reports `sandboxSupported`. An environment's generated configuration carries the same `runArgs`. `containersandbox.test.ts` covers both override shapes, the Compose discovery, the check on sample inspect output, and a folder and an environment connect with and without the option.