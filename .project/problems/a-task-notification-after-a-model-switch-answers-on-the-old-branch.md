---
title: A task notification after a model switch answers on the old branch
status: open
date: 2026-11-21
severity: major
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L853-L871](../../packages/agent-claude/src/session/query.ts#L853-L871) - `rebindForRestart` closes the old CLI and resumes a new one"
  - "[code://packages/agent-claude/src/session/query.ts#L822-L831](../../packages/agent-claude/src/session/query.ts#L822-L831) - `take` sends `setModel` to the CLI"
  - "[code://packages/agent-claude/src/session/parts.ts#L238-L265](../../packages/agent-claude/src/session/parts.ts#L238-L265) - `costOf` differences each CLI against its own baseline"
  - "[code://packages/agent-claude/src/session/query.ts#L412-L421](../../packages/agent-claude/src/session/query.ts#L412-L421) - `putAway` does not close the CLI it puts away"
  - "[code://packages/agent-claude/src/session/logins.ts#L315-L345](../../packages/agent-claude/src/session/logins.ts#L315-L345) - `restartAt`, a restart path the probes did not run"
  - "[code://packages/agent-claude/src/session/query.ts#L1602-L1627](../../packages/agent-claude/src/session/query.ts#L1602-L1627) - `rebindForSyncedState`, a restart path the probes did not run"
---

## Symptom

Two Claude CLIs wrote one conversation at the same time, after the user switched the model from Haiku to Sonnet.
The conversation forked into two branches, and the CLI's running total lost the spend of one of them.

The case is session `d5f25d91-b4ba-4d25-9e73-3010d89063a1`, chat `e5017385-2fd5-4fb4-b46e-a98e32024b59`, on 2026-11-21 (UTC):

| Time | Transcript entry | Model | Parent |
|---|---|---|---|
| 13:13:07 | `/model sonnet`, then the prompt "ok, merge when green" (turn `4dc6c6dc`) | | `7ada0b2a` |
| 13:13:52 | `compact_boundary`, and the turn goes on after it | Sonnet | none |
| 13:14:05 | A `task-notification` for the Monitor task `b3wuom16s` gets an answer | Haiku | `7ada0b2a` |
| 13:15:42 | The Haiku branch ends with "PR #414 is green" | Haiku | `4c19d3a2` |
| 13:15:42 | A `cost-state` line: total 20.6234, Haiku 1.6061 | | |
| 14:09:52 | A `cost-state` line: total 21.6566, Haiku 1.3696, Sonnet 1.2696 | | |

The Haiku answer at 13:14:05 has the parent of the `/model` entry, which is the entry before the switch and the compaction.
The Haiku figure goes back from 1.6061 to 1.3696, which is its figure in the 13:00:46 `cost-state`.
A single CLI keeps one running total, so two CLIs wrote these lines.

The records of this chat sum to 22.1617, and the transcript's last total is 21.9252.

## Cause

Unknown.
These facts limit it:

- ahpd started the turn `4dc6c6dc` at 13:12:32, and its prompt reached a CLI at 13:13:07.
- The new CLI wrote `/model sonnet` and the prompt after `7ada0b2a`, and started from the 13:00:46 `cost-state`.
- The old CLI held the Monitor task, answered its notification after `7ada0b2a`, and exited at 13:15:42.
- ahpd billed frames of the old CLI at 13:13:53 and 13:15:39, so its reader of the old CLI still ran.
- The record of `4dc6c6dc` has no usage, and the three records after it have host-made `turn-<ms>` ids.

The pattern of a lost turn and host-made turns after it is also in [a-running-claude-turn-is-lost-while-the-cli-keeps-working.md](a-running-claude-turn-is-lost-while-the-cli-keeps-working.md).

Two probes on 2026-11-21, with a real CLI on Haiku, removed these causes:

| Probe | Result |
|---|---|
| The SDK's `close()` on a CLI that holds a background task | The CLI exits with code 143, 2 s after `close()` |
| A turn that picks another agent after a background task starts, through `createSession` | One CLI after the restart, and the new CLI reports the end of the task |

A disposed session also closes its CLI.
These leads are open:

- `putAway` keeps the CLI it puts away open, but it also stops the reader, and the reader of the old CLI still ran here.
- Two hosts that both have the session open each run a CLI, and both write the same usage file. No daemon log covers 13:12, so this is not checked.
- `restartAt` and `rebindForSyncedState` close the old CLI before they start a new one, and no probe ran them.

## Impact

- The user does not see some answers. The Haiku answer "PR #414 is green" is on a branch that no later turn follows.
- Two CLIs on one conversation can each take an action, such as a merge, from different contexts.
- The billing is correct, because each CLI was billed against its own baseline. The 0.2365 was spent.
- The CLI's running total is lower than the true spend. A seed from the last `cost-state` stays correct, because the CLI restores the same line.

## Workaround

None.

## Fix

Candidates, none chosen:

- Keep one CLI for each conversation in a host: a start closes or refuses a CLI that still runs on it.
- Keep one CLI for each conversation across hosts, with a lock file next to the transcript.
- Close the CLI in `putAway`, so that no path keeps a CLI that nothing reads.
