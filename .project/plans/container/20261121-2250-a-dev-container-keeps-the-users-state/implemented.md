---
title: A dev container keeps the user's state - implemented
date: 2026-11-22
refs:
  - git://595965379
  - "[code://packages/computer/src/containersandbox.ts](../../../../packages/computer/src/containersandbox.ts)"
  - "[code://packages/computer/src/userstate.ts](../../../../packages/computer/src/userstate.ts)"
---

A client can now ask a dev container connect to keep the user's state on a second volume and to run with the options the command sandbox needs. Both the folder connect and the environment connect take `persistUserState` and `sandboxEnabled`; each stage of a connect that keeps state is reported on `vscode/devContainers/userState`, and every connect reports whether the running container can host the sandbox on `vscode/devContainers/sandboxSupport`. The connect result carries `sandboxSupported`, read from the container itself rather than from what the client asked for.

## What was built

- [`code://packages/computer/src/userstate.ts`](../../../../packages/computer/src/userstate.ts) - the state volume's name and labels, its mount target, the folder link script, its progress parser, and the running-container check.
- [`code://packages/computer/src/containersandbox.ts`](../../../../packages/computer/src/containersandbox.ts) - the sandbox override for a `devcontainer.json` and for a Compose service, including the CLI's Compose discovery, and the check of a running container's Docker settings.
- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - the state volume, the link and the four notices, plus the sandbox override on `up`, the inspect after it, the cleanup of the override's folder, and the answer on both connects.
- [`code://packages/computer/src/environments.ts`](../../../../packages/computer/src/environments.ts) - the environment's generated configuration carries the sandbox run arguments when the client asks for them.
- [`code://packages/sdk/src/types/containers.ts`](../../../../packages/sdk/src/types/containers.ts) - `persistUserState` and `sandboxEnabled` on both connects, `userState` and `sandboxSupport` on the sink, the stage type, and the required `sandboxSupported` on the result.
- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - the options read from both asks, and the two notices forwarded on the connection.

## Verified

- `pnpm typecheck` passes.
- `pnpm boundary` passes, with no undeclared imports.
- The reviewer fixed two test faults. The fake `docker` answered the link script's `command -v flock` before its link answer. The Compose discovery case wrote no `dockerComposeFile: []`, which VS Code's test writes.
- `packages/computer/test/userstate.test.ts` and `packages/computer/test/containersandbox.test.ts` were written for this plan, and every existing suite that builds a `ContainerPort` was updated for the required `sandboxSupported`. The reviewer ran them under the lock: computer 663 cases and sdk 5276 pass.

## Departures from the plan

- The agent session folders are `.config/ahpd`, `.claude`, `.pi` and `.config/cofold`. The plan named `.claude` as an example and named no full list; the set is ahpd's own state, kept where VS Code keeps its own server data.
- An environment's sandbox options are written into its generated configuration's `runArgs`, as VS Code's environment preparation does, rather than through a separate override file. The task named the override only for a folder's definition.
- The task's file list did not name `environments.ts`, the two fixtures, or the SDK test fakes. They were changed because both connects carry `sandboxEnabled`, and the scripted Docker and CLI had to record the sandbox options for the check to see them.

## Left for later

- Nothing in this plan. The four-item final checklist still names a cross-rebuild session test and the suite runs, which the owner runs under the lock.
