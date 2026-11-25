---
title: The context figure follows a long turn - implemented
date: 2026-11-14
refs:
  - git://ac4004cd2
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts) - the asks during a turn"
  - "[code://packages/agent-claude/test/agent-claude-context.test.ts](../../../../packages/agent-claude/test/agent-claude-context.test.ts) - the cases"
---

A Claude session tells a client its context during a long turn and after a compaction. Before, it told it only at the handshake and at a turn's end. PR #331 merged it on 2026-11-14.

## What was built

- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - a `compact_boundary` in a running turn asks `getContextUsage` again and sends the figure with `session/metaChanged`. A model reply on the main chain asks again when 30 s passed since the last ask, and a subagent's reply asks nothing.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts) - one ask during a turn at a time. A compaction during an ask asks once more when it settles. An answer is dropped when a later figure came or the CLI was put away.
- [`code://packages/agent-claude/test/agent-claude-context.test.ts`](../../../../packages/agent-claude/test/agent-claude-context.test.ts) - 7 new cases.

## Verified

- The agent-claude suite passed, 672 of 672, and tsc was clean.

## Departures from the plan

- None recorded.

## Left for later

- None.
