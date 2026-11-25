---
title: An automation runs once at a set time
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://cea147af8 - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, section *Later*, AHP 1.2.0 automations
  - "[code://packages/sdk/src/host/handshake.ts#L491-L497](../../../../packages/sdk/src/host/handshake.ts#L491-L497) - the automation capabilities the host advertises"
  - "[code://packages/sdk/src/host/actions.ts#L729-L760](../../../../packages/sdk/src/host/actions.ts#L729-L760) - `automation/createRequested` and `automation/updateRequested`, where a definition is checked"
  - "[code://packages/server/src/scheduled.ts#L413-L439](../../../../packages/server/src/scheduled.ts#L413-L439) - `schedulesOf`, which reads only `schedule` triggers"
  - "[code://packages/server/src/scheduled.ts#L615-L641](../../../../packages/server/src/scheduled.ts#L615-L641) - `fire`, the clock that starts due runs, with VS Code's catch-up rule"
  - "[code://packages/sdk/src/automations/automations.ts#L636](../../../../packages/sdk/src/automations/automations.ts#L636) - the operations an automation offers"
  - git://github.com/microsoft/agent-host-protocol@e36b0a20 - `types/channels-automation/state.ts`, `AutomationOneTimeTrigger`, and `types/common/commands.ts`, `AutomationCapabilities.oneTime`
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostAutomationService.ts` L289, L306, L1004-L1019, L1737-L1741 and L1813-L1826
  - npm://@microsoft/agent-host-protocol@1.1.0 - the package ahpd uses, which has no 1.2.0 automation types
---

## Goal

A person or an agent can make an automation that runs once, at a time they choose, as AHP 1.2.0 and VS Code main allow. The host advertises the one-time trigger and checks the definition as VS Code does. It fires the trigger once at its time, and keeps it from being edited once it has started.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "oneTime|OneTime" packages/` - nothing: ahpd has no one-time trigger.
- `rg "kind !== 'schedule'|kind === 'schedule'" packages/` - `scheduled.ts`, `commands/automation.ts` and `blueprint.ts` read only schedule triggers.
- `npm view @microsoft/agent-host-protocol versions` - 1.1.0 is the newest, on 2026-11-21.

### Runtime path

```
automation/createRequested -> actions.ts checks -> AutomationStore -> scheduled.ts nextRunAt and fire -> host run -> a session
```

### Gaps

- The handshake advertises no `oneTime`.
- No check refuses a one-time definition with two triggers or with disable conditions.
- `schedulesOf` skips a `oneTime` trigger, so it never fires.
- Nothing marks a one-time automation as started, so it could run again and be edited after it ran.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Build the one-time trigger and both targets | Softov, 2026-11-21, chose "All three" | 01, 02 |
| Build now on ahpd's own types for the 1.2.0 fields, swapped for the package's when 1.2.0 ships | Softov, 2026-11-21, chose "Build now on own types" | 01 |
| Advertise `oneTime: {}` wherever automations are advertised | (defaulted: VS Code L289) | 01 |
| A one-time automation has exactly one trigger and no disable conditions, refused in VS Code's words | (defaulted: VS Code L1813-L1826) | 01 |
| `runAt` must be an ISO 8601 time; a past `runAt` follows `misfirePolicy`, `runOnce` when absent | (defaulted: AHP `AutomationOneTimeTrigger`) | 02 |
| Once its run is created, the automation records the run in `_meta`, has no `nextRunAt`, and no longer offers `update` | (defaulted: VS Code `_consumeOneTime`, L306) | 02 |
| A manual run from `run` does not consume the one-time trigger | (defaulted: VS Code consumes on the trigger's own run, L1007-L1019) | 02 |
| The blueprint and the `automation` command stay schedule-only | (defaulted: neither is part of the protocol's create path) | - |

## Proposed architecture

- **Data flow** - a client's definition carries a `oneTime` trigger with `runAt`. The host checks it and stores it; the daemon's store reads `runAt` as the automation's `nextRunAt`.
- **Event flow** - at `runAt`, `fire` starts the run as it starts a schedule's, with the trigger's id in the origin. The store then marks the automation consumed.
- **State flow** - consumed is `_meta['ahpd.oneTimeRun']`, the run's resource. With it, `nextRunAt` is absent and `operations` drops `update`.
- **Layer responsibilities** - sdk: the types, the capability, the checks and the operations · server: the clock and the consumed mark.
- **Source-of-truth files** - [`code://packages/server/src/scheduled.ts`](../../../../packages/server/src/scheduled.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A one-time definition is advertised and checked](task-01-a-one-time-definition-is-checked.md) | done | - |
| [02 - The daemon fires it once](task-02-the-daemon-fires-it-once.md) | done | 01 |

## Risks and tradeoffs

- The local types are a copy of AHP main, which may still change before 1.2.0. The types file names the AHP commit, and the swap to the package compares them.
- A client on 1.1.0 does not know `oneTime`. It shows the trigger as unknown and preserves it, since the trigger is `@preserveUnknownMembers`.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: the handshake advertises `oneTime`.
- [x] A test: a one-time definition with two triggers, or with a disable condition, is refused in VS Code's words.
- [x] A test: the trigger fires once at `runAt`, and the automation then has no `nextRunAt` and no `update`.
- [x] A test: a `runAt` passed while the daemon was down runs once, or not at all with `skip`.
- [x] The gates pass: typecheck, boundary, and the sdk and server suites.
