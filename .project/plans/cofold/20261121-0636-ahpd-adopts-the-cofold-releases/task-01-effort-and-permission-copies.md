---
title: the effort and permission copies
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L15-L26](../../../../packages/agent-cofold/src/agent.ts#L15-L26) - the imports from `@cofold/agents` for the modes and efforts"
  - "[code://packages/agent-cofold/src/agent.ts#L182-L193](../../../../packages/agent-cofold/src/agent.ts#L182-L193) - the labels, which stay host-owned, and the descriptions, which come from cofold"
---

## Objective

ahpd reads the permission modes, the effort levels and their descriptions from `@cofold/agents`, with no copy of its own except the labels.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts` - no change; the check found the copies already removed.

## Steps

1. Read `packages/agent-cofold/src/agent.ts` lines 15 to 26 and confirm the modes and efforts come from `@cofold/agents`.
2. Read lines 182 to 193 and confirm `PERMISSION_LABELS` is the only local list.
3. Check `packages/agent-cofold/src/agent.ts` for a forced `features.reasoning` and find none.

## Validation

- The plan's *Resume state* records the check. No code changed.
