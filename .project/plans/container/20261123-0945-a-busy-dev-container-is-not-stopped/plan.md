---
title: A dev container a session runs in is not stopped
domain: container
status: built
priority: medium
created: 2026-11-23
revalidated: 2026-11-23
refs:
  - git://e68555ee0 - the last commit that holds `problems/a-dev-container-stop-misses-a-session-placed-by-computer-uri.md`, which this plan fixes
  - git://e68555ee0 - main when the plan was written
  - "[code://packages/computer/src/plugin.ts#L2506-L2523](../../../../packages/computer/src/plugin.ts#L2506-L2523) - the folder's `stop` and `remove` answer `true` and act on any machine they find"
  - "[code://packages/computer/src/plugin.ts#L2342-L2363](../../../../packages/computer/src/plugin.ts#L2342-L2363) - `enter` and `leave` count sessions, but only for disposable machines"
  - "[code://packages/computer/src/plugin.ts#L298-L307](../../../../packages/computer/src/plugin.ts#L298-L307) - `Disposable.sessions`, the set this plan widens to every machine"
  - "[code://packages/sdk/src/host/machines.ts#L211-L218](../../../../packages/sdk/src/host/machines.ts#L211-L218) - `inMachine`: the host tells the port each session that enters or leaves a machine"
  - "[code://packages/sdk/src/types/containers.ts#L291-L315](../../../../packages/sdk/src/types/containers.ts#L291-L315) - the `stop` and `remove` contract: `false` is \"it is still in use\""
  - "[code://packages/sdk/src/host/vscodemethods.ts#L560-L577](../../../../packages/sdk/src/host/vscodemethods.ts#L560-L577) - `placedOn`, the host's check, which sees only sessions placed by folder"
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts) - the dev container cases this plan adds to"
---

## Goal

A session placed with `computer://<id>` on a dev container's machine keeps it when a client stops or removes the folder's dev container. The computer plugin answers `false`, "it is still in use", while any session runs in the machine, whoever asked.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "enter\?\.\(|leave\?\.\(" packages/sdk/src/host` - the host tells the port each session in a machine through `inMachine`.
- `rg "sessions\.(add|delete|size)" packages/computer/src/plugin.ts` - the plugin counts sessions only in `disposables`.

### Runtime path

```
vscode/devContainers/stop -> host placedOn (folder sessions only) -> ContainerPort.stop(folder) -> computer plugin machineFor(folder) -> made.stop(id)
session enters machine -> host inMachine -> ComputerPort.enter(id, session) -> plugin counts (disposables only)
```

### Gaps

- The plugin forgets which sessions run in a machine that is not disposable.
- The folder's `stop` and `remove` never answer `false`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The computer plugin's folder `stop` and `remove` answer `false` while a session runs in the machine | Softov, 2026-11-23: "The computer plugin refuses" | 01 |
| The plugin counts the sessions of every machine from `enter` and `leave`, not only of disposable ones | [code://packages/sdk/src/host/machines.ts#L211-L218](../../../../packages/sdk/src/host/machines.ts#L211-L218): the host already reports every machine | 01 |
| The host's `placedOn` stays as it is | (defaulted: the plugin's answer now covers the case it misses) | 01 |

## Proposed architecture

- **Data flow** - a map from machine id to its sessions, filled by `enter` and emptied by `leave`. The disposable delay reads the same map.
- **Event flow** - unchanged.
- **State flow** - in memory; after a restart the host enters each session again as it starts.
- **Layer responsibilities** - computer: knows its machines' sessions and refuses. sdk: unchanged.
- **Source-of-truth files** - [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a busy machine refuses a folder stop](task-01-a-busy-machine-refuses-a-folder-stop.md) | done | - |

## Risks and tradeoffs

- A person who wants the container stopped ends its sessions first.
- After a daemon restart a session counts again only once it starts. A stop in between acts as today.

## Resume state

- **Done so far:** task 01, on 2026-11-23. [implemented.md](implemented.md) holds the checks.
- **Next action:** none. `built` on Softov's word, 2026-11-23.
- **Open questions:**
  1. Does `x-ahpd/computers/stop` refuse a busy machine too? - proposed: no. A person who names the machine asks for it by name, and this plan guards the folder's methods.
- **Watch out for:** the disposable delay arms when the count reaches zero; keep it for disposables only.

## Final verification checklist

- [ ] A folder stop and remove answer `false` while a session placed by `computer://<id>` runs in the folder's machine.
- [ ] Both act as today once the session leaves.
- [ ] The computer suite passes.
