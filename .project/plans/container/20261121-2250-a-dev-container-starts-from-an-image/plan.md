---
title: A dev container starts from an image
domain: container
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Dev container environments*"
  - "[code://packages/sdk/src/types/containers.ts#L112-L121](../../../../packages/sdk/src/types/containers.ts#L112-L121) - the container port: `connect` from a folder, and `disconnect`"
  - "[code://packages/computer/src/devcontainer.ts#L974](../../../../packages/computer/src/devcontainer.ts#L974) - the port's `connect`, through the Dev Container CLI"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L945-L1076](../../../../packages/sdk/src/host/vscodemethods.ts#L945-L1076) - the `vscode/devContainers/*` methods ahpd serves"
  - "[code://packages/sdk/src/host/handshake.ts#L581](../../../../packages/sdk/src/host/handshake.ts#L581) - `vscode.devContainers` in `_meta`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/devContainerEnvironments.ts`, the id, the URI and the image list; `node/devContainerEnvironments.ts`, the volumes, their labels and the container; `node/devContainerAgentHostService.ts#L314-L325` and `#L1295-L1325`, the suspended and removed checks and the removal; `common/agentHostExtensionProtocol.ts#L49-L101`, the params
---

## Goal

A client starts a dev container from an image instead of a workspace folder, as VS Code's window does for a new environment. The container's workspace lives in a Docker volume, so it outlives the container. A client can also remove the environment with its volumes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "connectEnvironment|removeEnvironment|devContainerEnvironments" packages/` - nothing.
- `rg "resume" packages/sdk/src/types/containers.ts` - nothing: a stopped container cannot be refused until it is resumed.

### Runtime path

```
vscode/devContainers/connectEnvironment {connectionId, environmentId, image, name, resume?} -> the environment's volume, found by label or made
  -> devcontainer up with the volume at /workspaces/<volume> -> the nested host -> the relay, as connect has
vscode/devContainers/removeEnvironment {environmentId} -> its relays closed -> the container and its volumes removed
```

### Gaps

- The port makes a container only from a folder's `devcontainer.json`.
- A stopped container restarts on the next `connect`; VS Code refuses that until the client says `resume`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan dev container environments, all of it, as two plans; this is the first | Softov, 2026-11-21, "All of it, as two plans (Recommended)" | 01, 02 |
| An environment id matches `^[a-z0-9][a-z0-9-]{0,63}$` | (defaulted: VS Code `isDevContainerEnvironmentId`) | 01 |
| The images allowed are VS Code's list, `mcr.microsoft.com/devcontainers/base:ubuntu` | (defaulted: VS Code `devContainerEnvironmentImages`) | 01 |
| The workspace volume carries `dev.container.volume=true` and `vscode.agents.environment=<id>`; its name is the image's tag, then `-2`, `-3`, skipping a name whose state volume exists | (defaulted: VS Code `createEnvironmentVolume`) | 01 |
| The volume is mounted at `/workspaces`, and the workspace is `/workspaces/<volume>` | (defaulted: VS Code `volumeTarget`) | 01 |
| The state volume's name is computed here, from the container's id labels, since a free name skips one whose state volume exists | (defaulted: VS Code `getDevContainerStateVolumeName`) | 01 |
| Before the first container, a `docker run --rm` makes the workspace folder and gives it to the remote user; the configuration sets `updateRemoteUserUID: false` and the id labels `vsc.devcontainer.volume.name` and `vsc.devcontainer.volume.folder` | (defaulted: VS Code `devContainerEnvironments.ts#L184-L212`) | 01 |
| The configuration goes in an owner-only cache folder | (defaulted: VS Code `prepareOwnerOnlyDirectory`) | 01 |
| `removeEnvironment` removes only an environment the caller's principal made, and is refused for another's | (defaulted: on a host with users, as `stop` and `remove` refuse another's relay) | 02 |
| A stopped environment or folder container is refused as `Dev Container for '<name>' is stopped.` unless `resume: true`; a removed one as `Dev Container '<name>' was deleted.` | (defaulted: VS Code L318-L323) | 02 |
| A removal closes every relay to the environment first, then removes the container and its volumes | (defaulted: VS Code `_removeEnvironment`) | 02 |
| `_meta` carries `vscode.devContainerEnvironments`; the methods need `container:connect` and `container:remove` | (defaulted: VS Code's capability, the existing grants) | 01, 02 |

## Proposed architecture

- **Data flow** - the port gains `connectEnvironment` and `removeEnvironment`. The computer plugin writes a `devcontainer.json` for the image and the volume, and runs `up` as `connect` does.
- **State flow** - the suspended and removed sources, by folder or environment.
- **Layer responsibilities** - sdk: the methods and the port's types; computer: the volumes and the container.
- **Source-of-truth files** - `packages/computer/src/environments.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A container starts from an image in a volume](task-01-a-container-starts-from-an-image.md) | done | - |
| [02 - An environment is resumed and removed](task-02-resumed-and-removed.md) | done | 01 |

## Risks and tradeoffs

- A removal deletes the workspace volume, and the work in it. Only `removeEnvironment` does that, and only for its owner; a `stop` keeps it.
- A folder container connected after a `stop` now needs `resume: true`. No client of Softov's calls a connect after a stop today.

## Resume state

- **Done so far:** both tasks: an environment's container made from an allowed image in a labelled volume, its host relayed, resume of a stopped one, and its removal with the volumes.
- **Next action:** none. Merged as #436, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** the tests need Docker; mark them as the other container cases are marked.

## Final verification checklist

- [ ] A test: a new environment makes a labelled volume, and a second connect reuses it.
- [ ] A test: an image off the list and a bad id are refused.
- [ ] A test: a stopped container is refused without `resume`, and a removed one is refused.
- [ ] A test: a removal closes the relays and removes the volumes.
- [ ] The gates pass: typecheck, boundary, and the sdk and computer suites, one at a time.
