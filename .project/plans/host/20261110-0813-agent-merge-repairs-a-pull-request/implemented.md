---
title: Agent Merge repairs a pull request - implemented
date: 2026-11-10
refs:
  - git://d558e2f06
  - "[code://packages/sdk/src/host/agentmerge.ts](../../../../packages/sdk/src/host/agentmerge.ts) - the watch and the repair turn"
---

With Agent Merge on, the host watches a folder's pull request. It starts a turn in the chat to fix what blocks it. PR #279 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/host/agentmerge.ts`](../../../../packages/sdk/src/host/agentmerge.ts) - reads a pull request's checks, jobs, logs, review threads and mergeable state through `gh` or a lent token. A failed required check, an open review thread or a conflict starts a repair turn.
- [`code://packages/sdk/src/tools/agentmerge.ts`](../../../../packages/sdk/src/tools/agentmerge.ts) - VS Code's four tools: `setAgentMergeEnabled`, `readAgentMergeCI`, `replyToAgentMergeReviewThread` and `rerunAgentMergeWorkflow`.
- [`code://docs/sdk/TOOLS.md`](../../../../docs/sdk/TOOLS.md) - Agent Merge.

## Verified

- The Agent Merge cases. CI passed on #279.

## Departures from the plan

- None recorded.

## Left for later

- None.
