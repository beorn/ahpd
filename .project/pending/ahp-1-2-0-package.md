---
title: Use the AHP 1.2.0 package when npm serves it
plans:
  - plans/host/20261121-0821-an-automation-runs-once-at-a-set-time/plan.md
  - plans/host/20261121-0821-an-automation-continues-a-session-or-a-chat/plan.md
---

# Use the AHP 1.2.0 package when npm serves it

The automation types of #404 and #406 are a copy of AHP main at `e36b0a20`, in `packages/sdk/src/types/automations-next.ts`. On 2026-11-21 npm serves `@microsoft/agent-host-protocol` 1.1.0 as the newest.

## When it is due

`npm view @microsoft/agent-host-protocol version` prints `1.2.0` or later.

## Steps

1. Compare `AutomationOneTimeTrigger`, `AutomationTarget` and `AutomationCapabilities` in the package with `automations-next.ts`. A difference is a change to plan, not to copy.
2. Move every range to the new version, as host/117 moved them to `^1.1.0`.
3. Import the types from the package, and delete `automations-next.ts`.
4. Remove the `oneTime` and `targets` entries from `WIDENED` in `packages/sdk/test/wire.test.ts`. The wire check passes without them.
5. Run typecheck, boundary, and the sdk, server and computer suites, one at a time.

Pass: the wire check finds no `oneTime` or `targets` departure, and the suites are green. Fail: a field differs from the copy, or the wire check still reports a departure.
