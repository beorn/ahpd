---
title: A resumed turn pays only its own cost - implemented
date: 2026-11-21
refs:
  - git://claude/20261121-1733-a-resumed-turn-pays-only-its-own-cost
  - "[code://packages/agent-claude/src/session/parts.ts](../../../../packages/agent-claude/src/session/parts.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts)"
  - "[code://scripts/repair-claude-usage.mjs](../../../../scripts/repair-claude-usage.mjs)"
---

A Claude turn that resumes a session is now charged what it added to the CLI's running total, not the total itself.
A script corrects the records that an older host wrote with the total.

## What was built

- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - `costStates` and `lastCostState`, the `cost-state` lines of a transcript.
- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - `seedCost` and `costUnknown`, which start the cost baseline.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - each start of the CLI sets the baseline before it runs.
- [`code://scripts/repair-claude-usage.mjs`](../../../../scripts/repair-claude-usage.mjs) - the repair, a dry run unless `--write` is given.
- `docs/server/USAGE.md` and `.project/specs/usage.md` - the rule and the script.

## Verified

- `agent-claude-usage.test.ts`: three new cases, 18 in the file. The agent-claude suite passes, 698 tests.
- `repair-claude-usage.test.ts`: five cases.
- `pnpm typecheck` and `pnpm boundary` pass.
- A dry run on this host corrects session `d5f25d91` from $80.43 to $0.49 on its four resumed turns. The session's records then sum to $22.16.
- Three sessions sum to their transcript's last total exactly after the dry run. Three sum a little above it, by the spend a rewind took off the CLI's own total.

## Departures from the plan

- A fork, a rewind and a session in a machine get no seed. Their first `result` has no cost, as the *Answers* row says.
- The repair is a script, not `ahpd usage repair`, by Softov's answer of 2026-11-21.
- The repair dates a `cost-state` line by the message before it, because the line has no time of its own.
- The rule went to `specs/usage.md`, because `specs/agent-backends.md` has no text on cost.

## Left for later

- The script was not run with `--write` on this host. Softov runs it with the daemon stopped.
- 112 chats on this host have no transcript, so the script leaves them unchecked.
