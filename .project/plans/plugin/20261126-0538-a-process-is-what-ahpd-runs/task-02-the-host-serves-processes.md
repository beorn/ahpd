---
title: The host serves processes
status: done
depends: 
  - task-01-a-kind-keeps-its-processes.md
layer: "sdk"
---

## Objective

The host serves `x-ahpd-processes://<id>`, sends what a running process reports, and stops one.

## Files

- `CREATE: packages/sdk/src/lists/processes.ts` - the channel, the report and the stop command.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - serve the channel where a list has a kind with processes.
- `CREATE: packages/sdk/test/list-processes.test.ts` - the cases.
- `UPDATE: docs/plugins/PLUGINS.md` - processes, in "A list of your own".
- `UPDATE: docs/updates/v0_16.md` - the SDK line.

## Steps

1. Start a process with a new id, a report and an abort signal.
2. Send each report on the process's channel.
3. Answer a subscribe from the kind's `processes.read`.
4. Serve `x-ahpd/processes/stop`, which aborts the signal.
5. Write the docs and the release line.

## Validation

- A subscriber gets each progress and log line, then `completed`.
- A stop ends the process as `stopped`.
- A finished process reads from the kind after the host forgets it.

## Resume

Built on 2026-11-26.
