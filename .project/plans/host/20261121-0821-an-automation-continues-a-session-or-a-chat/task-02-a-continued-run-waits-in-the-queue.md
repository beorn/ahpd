---
title: A continued run waits in the queue
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L615-L644](../../../../packages/sdk/src/host/automations.ts#L615-L644) - `request` and its overlap rules"
  - "[code://packages/sdk/src/host/queuedrain.ts#L237-L242](../../../../packages/sdk/src/host/queuedrain.ts#L237-L242) - `enqueue`"
---

## Objective

A `previousSession` run puts its message in the previous session's queue, as AHP says. It never steers, and it starts a new session when the previous one is unusable.

## Files

- `UPDATE: packages/sdk/src/host/automations.ts:615-644` - a continued target skips `overlap` and queues; `overlap` stays for new-session runs.
- `UPDATE: packages/sdk/src/host/automations.ts:471-475` - the previous session is checked usable: present, not archived, with a default chat, made from the same template.
- `CREATE: packages/sdk/test/automation-previous-session.test.ts` - the queue, the lifecycle and the fallback.

## Steps

1. Read VS Code's `_queueInPreviousSession` at L1322-L1366, and record its rules in Resume.
2. Link the session to the run with `automationRun/sessionSet` and make it primary, before `enqueue`.
3. Queue the message on the session's default chat with `enqueue`, with the template's `model` and `agent`.
4. Keep the run `pending` while its message waits, and set it `running` from the turn that takes it.
5. Cancel the run when a person withdraws its message.
6. Remove the message when a person cancels the run.
7. Start a new session when the previous one is unusable, and continue that one from then on.

## Validation

- `packages/sdk/test/automation-previous-session.test.ts` - a run during a turn queues and waits.
- The same file - it never steers with `overlap: steer`.
- The same file - a gone session starts a new one, and a cancel removes the message.
- The sdk vitest suite passes.

## Resume

VS Code's `_queueInPreviousSession` links the run to the session and makes it primary, then queues the message. The run stays pending until a turn takes it. Here `request` skips `overlap` for a run that continues a session or a chat. A busy pinned chat queues the message through `queueIn`, with the template's model, where it used to hold the wake or refuse a press. `enqueue` takes hooks: `taken` marks the run running before its turn is said, and `withdrawn` cancels it. A cancel of the run calls `dequeue`. The store marks a run running through its new `running` hook, or when its start resolves. An archived previous session starts a new one.
