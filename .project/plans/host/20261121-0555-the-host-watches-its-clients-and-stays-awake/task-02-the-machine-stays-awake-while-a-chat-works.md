---
title: The machine stays awake while a chat works
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L686-L692](../../../../packages/sdk/src/host/catalogue.ts#L686-L692) - the count of sessions running a turn"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostKeepAwake.ts` and `node/agentHostPowerSaveBlocker.ts`
---

## Objective

While a session runs a turn, the daemon keeps its machine from idle sleep, as `keepAwakeWhileWorking` says.
It lets go 2 minutes after the last turn ends.

## Files

- `CREATE: packages/server/src/keepawake.ts` - the hold, its release delay and the platform helpers.
- `UPDATE: packages/server/src/commands/run.ts` - the daemon holds and releases on the count of running sessions.
- `CREATE: packages/server/test/keepawake.test.ts` - the hold cases with fake timers and a fake helper.

## Steps

1. Read VS Code's `agentHostKeepAwake.ts` and `agentHostPowerSaveBlocker.ts`, and record their rules in Resume.
2. Port the hold and its 2 minute release delay.
3. Port the helper for each platform, and its power source check for `whenPluggedIn`.
4. Hold when the count of running sessions leaves zero, and release when it returns to zero.
5. Read the key on each change, so `never` releases at once.

## Validation

- `packages/server/test/keepawake.test.ts` - a turn starts the helper once, and it ends 2 minutes after the last turn.
- The same file - `never` starts nothing, and the daemon logs a failed helper once.
- The server vitest suite passes.

## Resume

The hold policy is in the host, `sdk/src/host/keepawake.ts`, since only the host knows the running count and holds the key. The daemon passes the helper as `HostOptions.keepAwake`, as VS Code's host is handed its `acquire`. `activeSessionsChanged` and a push of the key call `update`, and the host's close lets go. `server/src/keepawake.ts` ports the power save blocker: the three helpers, the 30 s power poll and the Linux power supply rules. A failing helper is logged once. The cases are `sdk/test/keepawake.test.ts`, `server/test/keepawake.test.ts`, and a turn in `turning.test.ts`.
