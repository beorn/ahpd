---
title: Cofold cases that wait by the clock time out on Windows
status: open
date: 2026-11-21
severity: minor
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-questions.test.ts#L78-L180](../../packages/agent-cofold/test/agent-cofold-questions.test.ts#L78-L180) - the cases, each waiting for a question by the clock"
  - git://270d6183c - main when the problem was read
---

## Symptom

On 2026-11-21, CI's `windows (2/4)` on #429, run 44943713018, failed three cases of `agent-cofold-questions.test.ts` with `timed out waiting`, after about 15 s each:

- `says a shell call's command in the shell cofold runs it through, with no options of its own`
- `answers cofold for the call alone, whatever option the host's answer names`
- `asks about a tool the operator's rule sets false in every mode, and refuses it under dontAsk`

15 s is `WAIT_MS` on Windows. #429 does not change `packages/agent-cofold`.

On 2026-11-26 CI's `windows (3/4)` on #481, run 45739041674, failed `agent-cofold-tools.test.ts`: `draws a shell call as a terminal, with its command as the intention` with `timed out waiting`. #481 does not change `packages/agent-cofold`.

## Cause

Unknown. The same job timed out two plugin import cases at 20 s, so the runner was slow.
Whether that is the whole cause is not checked.

## Impact

A Windows CI job can fail for no fault in the cofold agent.

## Workaround

None. A rerun is not a fix.
