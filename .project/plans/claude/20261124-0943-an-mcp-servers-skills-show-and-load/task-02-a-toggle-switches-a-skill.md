---
title: A toggle switches a skill
status: done
depends: [01]
layer: "agent-claude"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1990-L2010](../../../../packages/sdk/src/host/chatactions.ts#L1990-L2010) - the toggle, by id"
---

## Objective

`session/customizationToggled` with a skill's id turns that skill off or on, and the session keeps the choice.

## Files

- `UPDATE: packages/agent-claude/src/session/mcpskills.ts` - keep each skill's `enabled` per session.
- `UPDATE: packages/sdk/src/host/chatactions.ts:1990-2010` - find a customization by id among `children` too.
- `UPDATE: packages/agent-claude/test/agent-claude-mcp-skills.test.ts` - the toggle cases.

## Steps

1. Make `customizationUnder` find an entry among a server's `children` by its id.
2. Send a skill's toggle to agent-claude, which sets its `enabled`.
3. Say the session's customizations again with the new value.
4. Keep the choice where the session keeps its other customization choices.
5. Add cases: a toggle turns a skill off, a second turns it on, and the choice stays after a restart.

## Validation

- `agent-claude-mcp-skills.test.ts`: the toggle cases.
- Run the sdk suite, then the agent-claude suite, under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. No sdk source changed: a child with no enablement key already reaches the backend by its id. The choice is the session's, and goes with the daemon's process, as VS Code's host keeps it.
