---
title: A resumed turn pays only its own cost
domain: claude
status: built
priority: high
created: 2026-11-21
revalidated: 2026-11-21
changes:
  - specs/usage.md
refs:
  - git://76ab8bbba2605c9bfa47cabc89fb262106aa3541 - the commit of `main` the facts were checked at
  - git://365db60ee06d88a30d81aa9a70c10e766036e56e:.project/problems/a-resumed-claude-session-bills-its-whole-past-to-one-turn.md - the problem this plan fixes
  - "[code://packages/agent-claude/src/session/parts.ts#L152-L211](../../../../packages/agent-claude/src/session/parts.ts#L152-L211) - `paid`, `newConversation` and `costOf`, the baseline this plan seeds"
  - "[code://packages/agent-claude/src/session/query.ts#L632-L654](../../../../packages/agent-claude/src/session/query.ts#L632-L654) - where a query resumes the CLI session"
  - "[code://packages/agent-claude/src/session/query.ts#L1289](../../../../packages/agent-claude/src/session/query.ts#L1289) - `conversation_reset`, the one reset of the baseline today"
  - "[code://packages/agent-claude/src/session/query.ts#L1442](../../../../packages/agent-claude/src/session/query.ts#L1442) - where the cost goes on the turn"
  - "[code://packages/agent-claude/src/transcript.ts#L319](../../../../packages/agent-claude/src/transcript.ts#L319) - `sessionFiles`, the transcript path to reuse"
  - "[code://packages/agent-claude/src/transcript.ts#L330-L336](../../../../packages/agent-claude/src/transcript.ts#L330-L336) - the line reader of a transcript file, the pattern to reuse"
  - "[code://packages/sdk/src/usage/usage.ts#L328-L360](../../../../packages/sdk/src/usage/usage.ts#L328-L360) - how the store reads each line of a month file"
  - "[code://scripts/parts-bump.mjs](../../../../scripts/parts-bump.mjs) - the script pattern the repair copies"
  - "[code://packages/agent-claude/test/agent-claude-usage.test.ts](../../../../packages/agent-claude/test/agent-claude-usage.test.ts) - the usage cases the new ones join"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.325 - the CLI writes `{ type: \"cost-state\", totalCostUSD, modelUsage }` to the transcript and restores it on resume
---

## Goal

A Claude turn is charged what it cost, also the first turn after the CLI resumes a session.
Today that turn is charged the session's whole earlier cost, as the problem at `git://365db60ee` shows.
A repair script corrects the records that are already wrong.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `strings claude | grep lastModelUsage` in the 0.3.325 CLI binary - the CLI saves `modelUsage` in a `cost-state` entry and restores it from `costState` on resume.
- `grep '"type":"cost-state"' ~/.claude/projects/**/*.jsonl` - 164 transcripts on this host hold the entry, one line per save.
- `grep d5f25d91 ~/.config/ahpd/usage/2026-11-model.jsonl` - four turns of one session each billed the earlier total again.
- `rg -n "newConversation|costOf" packages/agent-claude/src` - nothing seeds `paid` on resume.

### Runtime path

```
query(resume) -> CLI restores cost-state -> result.modelUsage (session total) -> costOf (minus paid) -> turn _meta ahpd.cost -> meter -> usage.record
```

### Gaps

- `paid` starts empty in each query, so the first `result` after a resume bills the restored total.
- Nothing corrects records already in the store.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Seed the baseline from the transcript's last `cost-state` entry before the query resumes | Softov, 2026-11-21, picked "Seed from transcript (Recommended)" | 01 |
| A resumed query with no `cost-state` entry, or one that cannot be read, sends no cost on its first `result` | `(defaulted: no cost is safer than a wrong cost, and the tokens are still recorded)` | 01 |
| A fork, a rewind and a session in a machine charge nothing on the first `result`, and take it as the baseline | `(defaulted: a fork or a rewind loads the transcript only up to its cut, and a machine keeps its transcript out of this host's reach)` | 01 |
| A one-time repair corrects the records already written | Softov, 2026-11-21, picked "Repair command (Recommended)" | 02 |
| The repair is `scripts/repair-claude-usage.mjs`, run from a checkout | Softov, 2026-11-21, picked "One-time repo script" | 02 |
| The repair subtracts the largest `cost-state` total written since the record before it that is at most the record's cost, and changes no record whose transcript is gone | `(defaulted: the transcript is the only exact source, and a guess must not rewrite a charge)` | 02 |
| The repair is a dry run unless `--write` is given, and `--write` keeps a copy of each month file it changes | `(defaulted: the store is otherwise append-only)` | 02 |
| `--write` refuses while `daemon.json` names a process that runs | `(defaulted: the daemon rebuilds its totals from the files only at start)` | 02 |

## Proposed architecture

- **Data flow** - agent-claude reads the last `cost-state` line of the transcript before it resumes, and sets `paid` from its `modelUsage[model].costUSD`. The first `result` then differences from that figure.
- **State flow** - `paid` lives in the session's parts, as today. A seed replaces its contents, as `newConversation` clears them.
- **Layer responsibilities** - agent-claude: the seed and the transcript read · scripts: the repair · sdk: no change.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the-baseline-starts-from-the-transcript](task-01-the-baseline-starts-from-the-transcript.md) | done | - |
| [02 - a-repair-corrects-the-billed-past](task-02-a-repair-corrects-the-billed-past.md) | done | 01 |

## Risks and tradeoffs

- `cost-state` has no public type, and a CLI update can rename it - task 01 tests the reader against a fixture line. A missing entry gives no cost.
- The CLI restores the last `cost-state` line of the transcript - the seed reads that line before the query starts, so both read the same figure.
- The repair rewrites charges on pools and limits - it is a dry run by default and keeps a copy.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-21, in [implemented.md](implemented.md).
- **Next action:** none. Merged on 2026-11-21.
- **Watch out for:** `paid` is keyed by model, and `cost-state` keys `modelUsage` by the same model names.

## Final verification checklist

- [ ] A resumed session's first turn carries its own cost, in a test and on this host.
- [ ] `scripts/repair-claude-usage.mjs` shows the four turns of session `d5f25d91` with their corrected amounts.
- [ ] `pnpm typecheck`, `pnpm lint` and the agent-claude and server suites pass.
- [ ] `specs/usage.md` says how a resumed turn's cost is taken.
