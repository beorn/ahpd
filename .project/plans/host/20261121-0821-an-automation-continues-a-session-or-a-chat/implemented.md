---
title: An automation continues a session or a chat - implemented
date: 2026-11-21
refs:
  - "[code://packages/sdk/src/automations/targets.ts](../../../../packages/sdk/src/automations/targets.ts) - `targetOf` and the checks"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - `queueIn`, `beginInChat` and `moveChatAutomations`"
  - "[code://packages/sdk/src/host/queuedrain.ts](../../../../packages/sdk/src/host/queuedrain.ts) - the hooks on a queued message, and `dequeue`"
---

An automation says where its runs go with AHP 1.2.0's `target`: a new session, the session of the last run, or one chat. A run that continues a session or a chat waits in the chat's queue and never steers a turn. The older pinned mode reads as `previousSession`.

## What was built

- [`code://packages/sdk/src/automations/targets.ts`](../../../../packages/sdk/src/automations/targets.ts) - `targetOf`, `continues`, `targetProblem` and `retargeted`.
- [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - `request` without `overlap` for these targets, `queueIn`, `beginInChat`, `moveChatAutomations`, and an archived previous session made unusable.
- [`code://packages/sdk/src/host/queuedrain.ts`](../../../../packages/sdk/src/host/queuedrain.ts) - `enqueue` with the model and the `taken` and `withdrawn` hooks, and `dequeue`.
- [`code://packages/sdk/src/automations/automations.ts`](../../../../packages/sdk/src/automations/automations.ts) - the `running` hook: a run is `pending` until its turn starts.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - the target refusals, and the host's `target.session`.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `targets`.
- `docs/sdk/AUTOMATIONS.md` and `docs/sdk/AHP.md` - *Where a run goes*, and the refusals.

## Verified

- *where a run goes* in `automations.test.ts` and `automation-wake.test.ts` pass.
- The sdk suite passes, 5121 cases. The server and computer suites each failed one case at a load average near 15: the first-party load case and the disposable git volume case. Both have problem files, and both files pass alone.
- Typecheck and boundary pass.

## Departures from the plan

- A queued run is linked to its session when its turn starts, not before the message is queued. The store links a run's session when its start resolves.
- VS Code's check that a previous session was made from the same template is not ported. A gone or archived session still starts a new one.
- The move of a chat target is tested at `retargeted`, not with a real move. A move needs a backend that can resume a moved chat.
- A run that starts a new session is `pending` until its session is made and its turn starts, as VS Code marks a run. It used to read `running` from the moment it was recorded.
- One case of `automation-wake.test.ts` changed: *waits behind a turn a person is running in the chat it is pinned to*. It now expects the second run at once, `pending`, with its message in the chat's queue.
