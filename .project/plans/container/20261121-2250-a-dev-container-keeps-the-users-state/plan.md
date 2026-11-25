---
title: A dev container keeps the user's state
domain: container
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/container/20261121-2250-a-dev-container-starts-from-an-image/plan.md
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Dev container environments*, `sandboxSupport` and `userState`"
  - "[code://packages/computer/src/devcontainer.ts#L974](../../../../packages/computer/src/devcontainer.ts#L974) - the port's `connect`"
  - "[code://packages/sdk/src/types/containers.ts](../../../../packages/sdk/src/types/containers.ts) - the port, its sink and its options"
  - "[code://packages/computer/src/sandbox.ts](../../../../packages/computer/src/sandbox.ts) - the sandbox the nested host runs, which needs the container's sandbox options"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/devContainerState.ts`, the state volume, its labels and the folder links; `node/devContainerSandbox.ts`, the sandbox override and its check; `node/devContainerAgentHostService.ts#L350-L410`, the order of the stages; `common/agentHostExtensionProtocol.ts#L62-L101`, the two notices
---

## Goal

A client asks for a container that keeps the user's state in a second volume, so the agents' sessions survive a rebuilt container. It can also ask for a container in which the command sandbox works. As in VS Code, ahpd says how each stage went and whether the sandbox works there.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "persistUserState|sandboxEnabled|sandboxSupport|userState" packages/` - nothing.

### Runtime path

```
connect / connectEnvironment {..., persistUserState?, sandboxEnabled?}
  -> the state volume mounted, up with --skip-post-create, the folders linked, the user commands run
  -> vscode/devContainers/userState {connectionId, stage, outcome, ...} for mount, up, link, userCommands
  -> docker inspect -> vscode/devContainers/sandboxSupport {connectionId, supported}
```

### Gaps

- A rebuilt container loses the agents' sessions and the nested host's state.
- A container runs with Docker's default seccomp and AppArmor, under which the command sandbox cannot start.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan dev container environments, all of it, as two plans; this is the second | Softov, 2026-11-21, "All of it, as two plans (Recommended)" | 01, 02 |
| Both connect methods take `persistUserState` and `sandboxEnabled` | (defaulted: VS Code's two validators) | 01, 02 |
| The state volume is named as VS Code's `getDevContainerStateVolumeName` names it, with an optional folder prefix: `vscode-state-[<folder>-]<12 base-32 characters>`; the function comes from the image plan | (defaulted: VS Code `devContainerState.ts#L23`, L72-L78) | 01 |
| The folders kept are the nested host's state folder and each agent's session folder, such as `.claude`, as VS Code keeps `.copilot` and its server data | (defaulted: ahpd's own state, in VS Code's places) | 01 |
| `up` runs with `--skip-post-create`, and the lifecycle commands run after the link, so their changes are kept | (defaulted: VS Code L377-L378) | 01 |
| A container made with the setting on is linked on every later connect, even with the setting off | (defaulted: VS Code L388) | 01 |
| Each of `mount`, `up`, `link` and `userCommands` sends one `userState` notice, with VS Code's fields | (defaulted: VS Code `devContainerUserStateValidator`) | 01 |
| `sandboxEnabled` writes an override with `seccomp=unconfined`, `apparmor=unconfined`, `systempaths=unconfined` and `/dev/net/tun`, for a `devcontainer.json` and for a Docker Compose setup's service | (defaulted: VS Code `devContainerSandbox.ts`, `discoverComposeFiles`) | 02 |
| `sandboxSupport` reads the running container, not the asked override, and the connect result carries `sandboxSupported` | (defaulted: VS Code `isDevContainerSandboxSupported`, L405-L406) | 02 |

## Proposed architecture

- **Data flow** - the computer plugin mounts the state volume, runs `up`, links the folders, and runs the user commands. It then reads the container's security options.
- **Event flow** - the sink gains `userState` and `sandboxSupport`, which the host sends as notices on the connection.
- **Layer responsibilities** - sdk: the options, the sink and the notices; computer: the volume, the links and the override.
- **Source-of-truth files** - `packages/computer/src/userstate.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A container keeps the user's state](task-01-a-container-keeps-the-users-state.md) | done | - |
| [02 - A container runs the sandbox and says so](task-02-a-container-runs-the-sandbox.md) | done | 01 |

## Risks and tradeoffs

- `sandboxEnabled` weakens the container's own isolation, so the sandbox inside can make its own. Only a client's explicit request turns it on, as in VS Code.
- A folder link over a folder in use breaks the process using it. A container that was running keeps its existing folders, as VS Code's does.

## Resume state

- **Done so far:** 01, the state volume, the links and the four notices, on both connects; 02, the sandbox override on `up`, the inspect and `sandboxSupported`, on both connects.
- **Next action:** none. Merged as #443, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** the suites have not been run here; run the sdk and computer suites one at a time under the lock.

## Final verification checklist

- [ ] A test: a container with `persistUserState` keeps a session file across a rebuild.
- [ ] A test: the four `userState` notices, in order, with their counts.
- [ ] A test: `sandboxEnabled` gives a container that `sandboxSupport` reports as supported, and one without it reports false.
- [ ] The gates pass: typecheck, boundary, and the sdk and computer suites, one at a time.
