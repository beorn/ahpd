---
title: An automation continues a session or a chat
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/host/20261121-0821-an-automation-runs-once-at-a-set-time/plan.md
refs:
  - git://cea147af8 - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, section *Later*, AHP 1.2.0 automations
  - "[code://packages/sdk/src/host/automations.ts#L117-L125](../../../../packages/sdk/src/host/automations.ts#L117-L125) - `wakeOf`, which reads `_meta.ahpd.session` and `pinnedSession`"
  - "[code://packages/sdk/src/host/automations.ts#L471-L475](../../../../packages/sdk/src/host/automations.ts#L471-L475) - `pinnedChat`, the session a pinned run continues"
  - "[code://packages/sdk/src/host/automations.ts#L615-L644](../../../../packages/sdk/src/host/automations.ts#L615-L644) - `request`, with the overlap rules"
  - "[code://packages/sdk/src/host/automations.ts#L717-L725](../../../../packages/sdk/src/host/automations.ts#L717-L725) - `keepPinned`, which writes the pinned session into `_meta`"
  - "[code://packages/sdk/src/host/queuedrain.ts#L237-L242](../../../../packages/sdk/src/host/queuedrain.ts#L237-L242) - `enqueue`, the host's queued pending message"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L76](../../../../packages/sdk/src/host/sessionmethods.ts#L76) - `createChatMover`, which moves a chat to another session"
  - "[code://packages/sdk/src/host/handshake.ts#L491-L497](../../../../packages/sdk/src/host/handshake.ts#L491-L497) - the automation capabilities"
  - git://github.com/microsoft/agent-host-protocol@e36b0a20 - `types/channels-automation/state.ts`, `AutomationTarget` and its three kinds, and `types/common/commands.ts`, `AutomationTargetsCapabilities`
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/agentHostAutomationService.ts` L293, L1289-L1291, L1322-L1366 and L1813-L1815
---

## Goal

An automation says where its runs go, with AHP 1.2.0's `target`. A run can start a new session, continue the session of the automation's last run, or send its message to one chat a person chose. A continued run waits in the chat's queue, as the protocol says. It never steers a turn. ahpd's own pinned mode becomes the protocol's `previousSession`, so one field names it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "pinnedSession" packages/` - `automations.ts`, `actions.ts`, `types/triggers.ts` and `commands/automation.ts`.
- `rg "previousSession|AutomationTarget" packages/` - nothing: ahpd reads no `target`.
- `rg "enqueue" packages/sdk/src/host/queuedrain.ts` - the queued pending message a run of a continued session uses.

### Runtime path

```
a trigger or run -> automations.ts request -> targetOf(definition) -> new session | enqueue in the previous run's session | enqueue in the chosen chat -> run lifecycle
```

### Gaps

- The host advertises no `targets`, and reads no `target`.
- A pinned run that finds a turn running holds itself in the host, where the protocol puts its message in the chat's queue.
- Under a pinned run, `overlap` may steer the running turn or run beside it, which the protocol forbids for these targets.
- No automation can name one chat as its target, nor follow that chat when it moves.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Build `previousSession` and `chat` with the one-time trigger | Softov, 2026-11-21, chose "All three" | 01, 02, 03 |
| `target` is the field; `_meta.ahpd.session: 'pinned'` with no `target` still reads as `previousSession` | Softov, 2026-11-21, chose "target is the field, pinned still read" | 01 |
| A `previousSession` or `chat` run queues its message and never steers; `overlap` applies only to new-session runs | Softov, 2026-11-21, chose "Follow the spec: always queue" | 02 |
| Build on ahpd's own types for `target`, in the file of the one-time plan | Softov, 2026-11-21, chose "Build now on own types" | 01 |
| Advertise `targets: { previousSession: {}, chat: {} }` | (defaulted: AHP `AutomationTargetsCapabilities`; VS Code advertises `previousSession` at L293) | 01 |
| An unknown target kind, or `chat` naming a chat that does not exist or that the automation's owner may not drive, is refused | (defaulted: AHP `AutomationChatTarget`; VS Code L1813-L1815) | 01, 03 |
| The host sets `target.session` to the chat's owning session, replacing what a client sent | (defaulted: AHP `AutomationChatTarget.session`) | 03 |
| The previous session is the primary session of the newest earlier run that has one; one that is gone, archived, or made from another template starts a new session | (defaulted: AHP `AutomationPreviousSessionTarget`; VS Code L1322-L1344) | 02 |
| A continued run is `pending` while its message is queued, `running` from its turn, and `cancelled` when the message is withdrawn | (defaulted: AHP `AutomationPreviousSessionTarget`) | 02 |
| `pinnedSession` stays in `_meta.ahpd` as the host's record of the last session | (defaulted: it is how a restart finds the session today) | 02 |

## Proposed architecture

- **Data flow** - `targetOf(definition)` answers `newSession`, `previousSession` or `chat`, from `target` or from the old pinned mode.
- **Event flow** - a run of a continued target links the session with `automationRun/sessionSet` and makes it primary. It then calls `enqueue` on the default chat or the chosen chat. The turn that takes the message moves the run to `running`.
- **State flow** - a chat target's `session` follows `createChatMover`: a move updates the definition and publishes `automation/set`.
- **Layer responsibilities** - sdk: the target, the queue path, the chat follow and the capability. The daemon's store keeps `target` as any other definition field.
- **Source-of-truth files** - [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A definition names its target](task-01-a-definition-names-its-target.md) | done | - |
| [02 - A continued run waits in the queue](task-02-a-continued-run-waits-in-the-queue.md) | done | 01 |
| [03 - A chat target follows its chat](task-03-a-chat-target-follows-its-chat.md) | done | 02 |

## Risks and tradeoffs

- A person who set `overlap: steer` on a pinned automation loses the steer. Softov chose the spec's queue on 2026-11-21.
- ahpw's automation form writes `_meta.ahpd.session`. It keeps working through the old spelling until ahpw writes `target`, which is ahpw's own change.
- `chat` has no VS Code code to port. The plan follows the AHP text alone for it.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: the handshake advertises both targets.
- [x] A test: an old pinned definition with no `target` continues its session, as `previousSession`.
- [x] A test: a `previousSession` run while a turn runs queues its message, stays `pending`, and runs when the turn ends; it never steers.
- [x] A test: a run whose previous session is gone starts a new session.
- [x] A test: a `chat` target to a missing chat is refused, its `session` is the host's, and it follows the chat's move.
- [x] The gates pass: typecheck, boundary, and the sdk and server suites.
