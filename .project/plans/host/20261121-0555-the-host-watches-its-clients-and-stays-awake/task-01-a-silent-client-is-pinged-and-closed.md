---
title: A silent client is pinged and closed
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/listen.ts#L531-L536](../../../../packages/sdk/src/listen.ts#L531-L536) - where a socket's messages arrive"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `ProtocolLivenessMonitor` and its use at `protocolServerHandler.ts` L858-L875
---

## Objective

A socket that sends nothing for 10 s gets a `ping` request, and one still silent 20 s later is closed.
Any inbound data resets the wait, and a host under load defers the close.

## Files

- `CREATE: packages/sdk/src/liveness.ts` - the monitor, ported from VS Code's.
- `UPDATE: packages/sdk/src/listen.ts:531-536` - each socket gets a monitor, fed by its messages.
- `CREATE: packages/sdk/test/liveness.test.ts` - the monitor's cases with fake timers.

## Steps

1. Read VS Code's `ProtocolLivenessMonitor`, and record its rules in Resume.
2. Port it to `liveness.ts`, with the same timings.
3. Start one for each socket in `listen.ts`, and stop it at the socket's close.
4. Send the ping as VS Code does, and close the socket on a timeout.

## Validation

- `packages/sdk/test/liveness.test.ts` - a silent socket gets a ping at 10 s, and the host closes it at 30 s.
- The same file - inbound data resets the wait, and an answered ping keeps the socket.
- The sdk vitest suite passes.

## Resume

`liveness.ts` ports `ProtocolLivenessMonitor` and VS Code's `LoadEstimator`, with the 10 s and 20 s timings. `watchClient` checks a socket from its `initialize` or `reconnect` on, sends `ping` on the root channel through `peer.request`, and closes the socket on a timeout. `listen.ts` gives each socket one, on Node, Bun and Deno, and stops it at the close. A stdio connection is not checked, as VS Code skips a `MessagePort`. The cases are in `liveness.test.ts`, with fake timers.
