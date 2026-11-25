---
title: A repair script corrects the records billed with the past cost
status: done
depends: [task-01-the-baseline-starts-from-the-transcript.md]
layer: "scripts"
refs:
  - "[code://scripts/parts-bump.mjs](../../../../scripts/parts-bump.mjs) - the script pattern to copy: a dry run, a copied format, a test that runs it"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts) - the test pattern to copy"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `costStates` and `sessionFiles`, the reading the script copies"
  - "[code://packages/server/src/config.ts#L761-L778](../../../../packages/server/src/config.ts#L761-L778) - `configDir` and `daemonPath`"
  - "[code://packages/sdk/src/usage/usage.ts#L328-L360](../../../../packages/sdk/src/usage/usage.ts#L328-L360) - how a month file's lines are read"
---

## Objective

`node scripts/repair-claude-usage.mjs` lists each Claude record that was charged a restored total, with its corrected cost.
With `--write`, it rewrites those records and keeps a copy of each month file it changes.

## Files

- `CREATE: scripts/repair-claude-usage.mjs` - the repair, with its own copy of the `cost-state` reading.
- `CREATE: packages/agent-claude/test/repair-claude-usage.test.ts` - the repair cases, run against a copy of the script.
- `UPDATE: docs/server/USAGE.md` - say what the script does and when to run it.

## Steps

1. Read the agent records in `<config>/agents/*.json`, and keep the ids whose `engine` is `claude`.
2. Read every line of `<config>/usage/*-model.jsonl` whose `agent` is one of those ids and whose cost is `from: harness`.
3. Group the records by session and chat, in time order.
4. Find each group's transcript under `<claude>/projects/*/`, by the chat's id, then by the session's id.
5. Give each `cost-state` line the timestamp of the last line before it that has one.
6. Take each `cost-state` line's total as the sum of its `modelUsage[model].costUSD`.
7. For each record, take the `cost-state` lines dated after the group's record before it and not after the record.
8. Pick the largest total of those lines that is at most the record's cost plus 0.000001.
9. Set the corrected cost to the record's cost minus that total, and at least 0.
10. Leave a record unchanged when no line qualifies, and a group unchanged when its transcript is missing.
11. With `--until <time>`, skip each record after that time.
12. Print each changed record: the time, the session, the turn, the recorded cost and the corrected cost.
13. Print the sum of recorded and corrected costs for each changed session, and each group with no transcript.
14. With `--write`, stop with an error when `daemon.json` names a process that runs.
15. With `--write`, copy each month file to `<file>.bak-<time>` before the script changes it.
16. With `--write`, set `amount` in each changed record's `cost` and `providerCost`, and keep every other byte of the line order.
17. Add a test: a session with four restored totals prints four changed records with the corrected amounts.
18. Add a test: a fixed host's resumed record, with a cost below the restored total, stays unchanged.
19. Add a test: a group with no transcript prints as not checked and stays unchanged.
20. Add a test: `--write` changes the month file, keeps a copy, and leaves the other records byte for byte.
21. Add a test: `--write` while `daemon.json` names this test's own process stops and changes no file.
22. Add the script to `docs/server/USAGE.md`.

## Validation

- `packages/agent-claude/test/repair-claude-usage.test.ts` holds the cases of steps 17 to 21.
- `npx vitest run packages/agent-claude/test/repair-claude-usage.test.ts` passes.
- By hand: run the script on this host with no flag.
- Check that session `d5f25d91` shows turns `4dabf65f`, `e2fd0319`, `6d38a697` and `ba5f25ed` under $1.

## Resume

The plan asked for `ahpd usage repair`.
`server` does not depend on the agent-claude plugin, and a plugin adds RPC methods and no `ahpd` command, so Softov chose a script on 2026-11-21.
A `cost-state` line has no timestamp, and the CLI writes one when a process ends.
A rewind can restore a lower total than the last line.
The rule in steps 7 and 8 replaces "the first total at or after the record's time".

Built 2026-11-21. The five cases pass, and a dry run on this host gives the amounts in [implemented.md](implemented.md).
