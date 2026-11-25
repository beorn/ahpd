---
title: The host watches its clients and stays awake - implemented
date: 2026-11-21
refs:
  - "[code://packages/sdk/src/liveness.ts](../../../../packages/sdk/src/liveness.ts) - the monitor and `watchClient`"
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts) - one monitor per socket"
  - "[code://packages/sdk/src/host/keepawake.ts](../../../../packages/sdk/src/host/keepawake.ts) - the hold policy"
  - "[code://packages/server/src/keepawake.ts](../../../../packages/server/src/keepawake.ts) - the idle sleep helpers"
---

The host pings a client that is silent for 10 s, and closes it when it is still silent 20 s later. While a session runs a turn, the host holds the machine's idle sleep as `keepAwakeWhileWorking` says. It lets go 2 minutes after the last turn ends.

## What was built

- [`code://packages/sdk/src/liveness.ts`](../../../../packages/sdk/src/liveness.ts) - `LivenessMonitor`, VS Code's load estimator, and `watchClient`, which checks a socket from its `initialize` or `reconnect` on.
- [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts) - a monitor for each socket on Node, Bun and Deno, fed by each message and stopped at the close.
- [`code://packages/sdk/src/host/keepawake.ts`](../../../../packages/sdk/src/host/keepawake.ts) - `createKeepAwake`, with the mode, the 2 minute release and `HostOptions.keepAwake`.
- [`code://packages/server/src/keepawake.ts`](../../../../packages/server/src/keepawake.ts) - `holdIdleSleep`, the helpers for macOS, Linux and Windows, and the power source checks.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon hands the helper to the host.

## Verified

- `liveness.test.ts`, `sdk/test/keepawake.test.ts`, `server/test/keepawake.test.ts` and the keep-awake case of `turning.test.ts` pass.
- The sdk suite passes, 5110 cases, and the server suite, 1991 cases with this file fixed. Typecheck and boundary pass.

## Departures from the plan

- The hold policy is in the host, not in `commands/run.ts`. Only the host knows the running count and holds the key, and VS Code's host is handed its `acquire` the same way.
- The liveness cases test the monitor with a stand-in socket. No case runs a real socket for 30 s.
- A stdio connection is not checked, as VS Code skips a `MessagePort` transport.
