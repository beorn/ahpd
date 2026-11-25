---
title: The orchestration limits are a host option
domain: host
status: built
priority: medium
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://6a5eafe36 - the last commit that holds the problem the-51st-session-case-runs-at-its-budget.md, which this plan fixes
  - "[code://packages/sdk/src/host/tooling.ts#L56-L98](../../../../packages/sdk/src/host/tooling.ts#L56-L98) - VS Code's limits as constants, and `ORCHESTRATION_LIMITS`, the one map the checks read"
  - "[code://packages/sdk/src/types/host.ts#L908](../../../../packages/sdk/src/types/host.ts#L908) - `agentOrchestrationLimitsScope`, the option the new one sits beside"
  - "[code://docs/sdk/HOST.md#L95](../../../../docs/sdk/HOST.md#L95) - the options table, with `agentOrchestrationLimitsScope`"
  - "[code://packages/sdk/test/sessiontools.test.ts#L1179-L1350](../../../../packages/sdk/test/sessiontools.test.ts#L1179-L1350) - the cases that make 50 sessions, 50 chats or 100 messages before the one refused"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L46-L94 - VS Code's limiters, whose numbers stay the default
---

## Goal

A host built with `createHost` can set how many sessions, chats and messages the session tools allow per budget.
The default stays VS Code's 50, 50 and 100.
The limit cases set small numbers, so each makes a few sessions instead of 50, and runs well inside its 5 s budget.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

| Case | Makes | Time on 2026-11-18 |
| --- | --- | --- |
| "refuses the 51st session in one tree, and still makes one in a second" | 51 sessions | 3712 ms, and one timeout at 5000 ms on 2026-11-17 |
| "keeps each session's count where the daemon counts per session" | 51 sessions | 3610 ms |
| "makes a session again once the oldest of its tree's fifty has left the hour" | 51 sessions | 3226 ms |
| "refuses the 51st chat in one tree, by either tool that makes one" | 51 chats | 2376 ms |
| "refuses the 101st message sent through the tools" | 101 messages | 528 ms |
| "does not count a send that failed" | 100 messages | 581 ms |
| "counts messages sent to any session against the sender, not the target" | 100 messages | 722 ms |

### Searches performed

- `rg "MAX_CREATED_SESSIONS|MAX_CREATED_CHATS|MAX_SENT_MESSAGES" packages/sdk/src` - the three constants are read only through `ORCHESTRATION_LIMITS` in `tooling.ts`.
- `rg "for \(let i = 0; i < (50|100)" packages/sdk/test` - the seven cases in the table.

### Gaps

- Nothing sets the three counts, so a case must reach VS Code's numbers to test a refusal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A `HostOptions` setting sets the counts, documented, with VS Code's numbers as the default | Softov, 2026-11-18: "A HostOptions setting" | 01 |
| Every case that counts to a limit uses a small limit | Softov, 2026-11-18: "Every case that counts to a limit" | 02 |
| The option is `orchestrationLimits: { sessions?, chats?, messages? }`, each a positive integer | (defaulted: the name and keys of the map it overrides) | 01 |
| `ahpd` does not read it from `config.json` | (defaulted: no person asked for the daemon to change VS Code's numbers) | 01 |
| The spawn depth of 3 stays a constant | (defaulted: no case counts to it slowly) | - |
| The default numbers are checked by value, through an exported `DEFAULT_ORCHESTRATION_LIMITS` | (defaulted: a refusal at the default would need 50 sessions again) | 02 |
| The cases set 3 sessions, 3 chats and 5 messages | (defaulted: enough to show a count, few enough to be fast) | 02 |

## Proposed architecture

- **Data flow** - `createHost` reads `orchestrationLimits` once, merges it over `DEFAULT_ORCHESTRATION_LIMITS`, and the checks read the merged maxima.
- **Layer responsibilities** - sdk: `tooling.ts`, `types/host.ts` · docs: `HOST.md` · tests: `sessiontools.test.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the counts are a host option](task-01-the-counts-are-a-host-option.md) | done | - |
| [02 - the limit cases count to a few](task-02-the-limit-cases-count-to-a-few.md) | done | 01 |

## Risks and tradeoffs

- One more host option that VS Code does not have - it is left out of `config.json`, and its default is VS Code's.
- A case with a small limit runs no 50 sessions - one case checks the default by value.

## Resume state

- **Done so far:** tasks 01 and 02 are `implemented` on 2026-11-18, on the branch `host/20261118-0603-the-orchestration-limits-are-a-host-option`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** the refusal sentence names the number; a case with a limit of 3 reads "3 of 3", not "50 of 50".

## Final verification checklist

- [ ] The sdk and computer suites pass, one at a time, and `check` and `check-windows` are green.
- [ ] No case in `sessiontools.test.ts` loops 50 or 100 times.
- [ ] Each limit case runs under 1 s in a local run.
