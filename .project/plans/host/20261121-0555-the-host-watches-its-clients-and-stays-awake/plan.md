---
title: The host watches its clients and stays awake
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/host/20261121-0524-the-small-vscode-main-fixes/plan.md
refs:
  - git://e5ba79bf4 - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, the facts, section *Host liveness and keep-awake*
  - "[code://packages/sdk/src/listen.ts#L531-L536](../../../../packages/sdk/src/listen.ts#L531-L536) - a socket's messages and its close"
  - "[code://packages/sdk/src/host/catalogue.ts#L686-L692](../../../../packages/sdk/src/host/catalogue.ts#L686-L692) - `activeSessionsChanged`, the count of sessions running a turn"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts` L153-L154 and L858-L905, `node/agentHostKeepAwake.ts`, `node/agentHostPowerSaveBlocker.ts`
  - npm://@microsoft/agent-host-protocol@1.1.0 - `dist/client/client.js` L579, which answers an unknown server request `MethodNotFound`
---

## Goal

The host notices a client that went silent, as VS Code's host does.
It pings a client that sent nothing for 10 s, and closes its connection after 20 s more with nothing heard.
The host also keeps its machine from idle sleep while a chat works, as the root key `keepAwakeWhileWorking` says.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Build the liveness check and keep-awake | Softov, 2026-11-21, chose "Host liveness and keep-awake" | 01, 02 |
| Ping after 10 s of silence, close after 20 s more; any inbound data counts | (defaulted: VS Code `CLIENT_PING_INTERVAL`, `CLIENT_LIVENESS_TIMEOUT`) | 01 |
| The ping is a request `ping` with `{ channel: 'ahp-root://' }`, which a client answers or refuses | (defaulted: VS Code L865; the AHP client answers an unknown request `MethodNotFound`, which counts as data) | 01 |
| A host under load defers the close, as VS Code's monitor does | (defaulted: VS Code `ProtocolLivenessMonitor` with its load estimator) | 01 |
| A connection that is not a socket, such as a test's peer, is not checked | (defaulted: VS Code skips a `MessagePort` transport) | 01 |
| The host holds keep-awake while a session runs a turn, and lets go 2 minutes after the last one stops | (defaulted: VS Code `RELEASE_DELAY`) | 02 |
| macOS runs `caffeinate -i -w <pid>`, Linux `systemd-inhibit --what=idle`, and Windows PowerShell's `SetThreadExecutionState` | (defaulted: VS Code `agentHostPowerSaveBlocker.ts` L115-L126) | 02 |
| `whenPluggedIn`, the default, holds only on mains power, and allows sleep where the power source is unknown, as on a Linux desktop | (defaulted: VS Code's description of the key) | 02 |
| A helper that fails to start is logged once, and the host goes on | (defaulted: keep-awake is a convenience) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A silent client is pinged and closed](task-01-a-silent-client-is-pinged-and-closed.md) | done | - |
| [02 - The machine stays awake while a chat works](task-02-the-machine-stays-awake-while-a-chat-works.md) | done | - |

## Risks and tradeoffs

- A client that ignores an unknown request and sends nothing else is closed after 30 s. The AHP client answers it, and so does VS Code's window.
- The keep-awake helpers are processes outside the daemon. Each is started once per hold and ended at release.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: a silent socket gets a ping after 10 s and is closed 20 s later, with fake timers.
- [x] A test: a client that answers stays open.
- [x] A test: a turn starts a hold, and the hold ends 2 minutes after the last turn.
- [x] A test: `never` holds nothing.
- [x] The gates pass: typecheck, boundary and the sdk and server suites.
