---
title: the turn-cut reason
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L398-L430](../../../../packages/agent-cofold/src/transcript.ts#L398-L430) - the transcript that shows a cut turn"
---

## Objective

ahpd shows the reason a turn was cut, as cofold gives it, in its transcripts.

## Files

- `UPDATE: packages/agent-cofold/src/transcript.ts` - show the reason with the cut turn.

## Steps

1. Read the cut-turn plan at `/github/cofold/.project/plans/agent/09-a-cut-turn-says-why-it-was-cut/plan.md` and find the field the reason is in.
2. Find where ahpd's transcript shows a cut turn today.
3. Show the reason in the same place, in ahpd's own words.
4. Add one test in `packages/agent-cofold/test` for a cut turn with a reason.
5. Run `pnpm exec vitest run packages/agent-cofold`.

## Validation

- The new test passes, and the agent-cofold suite still passes.

## Result

No code change. cofold 0.4.0 writes the cancel reason into the marker, `[Request interrupted: <reason>]`. The transcript shows the marker as a `systemNotification` in the cut turn. A test in `agent-cofold-store.test.ts` now checks it for "a new message took its place".
