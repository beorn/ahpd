---
title: A connector's wake counts against the cap
domain: host
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://2c3f1edb0 - the last commit that holds the problem a-webhook-automation-skips-the-wake-cap.md, which this plan fixes
  - "[code://packages/sdk/src/host/automations.ts#L1365-L1398](../../../../packages/sdk/src/host/automations.ts#L1365-L1398) - `runOne`, which calls `fly` and starts a run at once"
  - "[code://packages/sdk/src/host/automations.ts#L614-L640](../../../../packages/sdk/src/host/automations.ts#L614-L640) - `request`, which counts an event's wake and applies `skip`, `queue`, `steer` and `parallel`"
  - "[code://packages/sdk/src/host/automations.ts#L1476](../../../../packages/sdk/src/host/automations.ts#L1476) - a plugin's `run`, the seam `runOne` serves"
  - "[code://packages/webhook/src/route.ts#L132](../../../../packages/webhook/src/route.ts#L132) - the webhook calls `run` for each proved call"
  - "[code://docs/sdk/AUTOMATIONS.md#L183-L188](../../../../docs/sdk/AUTOMATIONS.md#L183-L188) - *What stops a wake*: 20 runs an hour"
---

## Goal

A run a connector asks for by the automation's id is a wake like an event's.
It counts against the 20 runs an hour, and the automation's overlap mode decides what happens while a run of it is going.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- An event's wake goes through `request`, which drops one past the hourly cap and applies the overlap mode.
- `runOne` checks the owner, the switch and the reader, and then calls `fly`, which starts a run at once.
- So a webhook sender with proved calls starts as many runs at once as it posts.

### Searches performed

- `rg "runOne" packages/sdk/src` - one definition, and one seam: a plugin's `run`.
- `rg "\.run\(" packages/webhook/src` - the webhook route calls it once per proved call.

### Gaps

- A connector's wake is neither counted nor held by the overlap mode.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `runOne` hands its wake to `request` with `byEvent: true` | (defaulted: the problem's one fix) | 01 |
| The owner, switch and reader checks of `runOne` stay before `request` | (defaulted: they say why a run was not started, which `request` does not) | 01 |

## Proposed architecture

- **Data flow** - `runOne` builds the facts and the origin as now, and calls `request(resource, origin, facts, said, true)` in place of `fly`.
- **Layer responsibilities** - sdk: `automations.ts` · docs: `AUTOMATIONS.md`, the notes.
- **Source-of-truth files** - [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a connector's wake goes through request](task-01-a-connectors-wake-goes-through-request.md) | done | - |

## Risks and tradeoffs

- A connector past 20 calls an hour to one automation loses the rest - the cap is the point, and the log says each drop.

## Resume state

- **Done so far:** task 01.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** `skip` drops a wake before it is counted, so a skipped call is not one of the 20.

## Final verification checklist

- [ ] On the test daemon, 25 proved webhook calls to one `parallel` automation start 20 runs.
- [ ] The same calls to a `queue` automation start one run and hold the rest.
- [ ] The sdk, computer and webhook suites pass, one at a time, and `check` and `check-windows` are green.
