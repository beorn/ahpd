---
title: Each backend asks what the operator says to ask
domain: host
status: built
priority: high
created: 2026-11-16
revalidated: 2026-11-16
refs:
  - git://657b43e23 - the last commit that holds `problems/backends-skip-the-operators-always-ask-rule.md`, with its reproduction of 2026-11-16
  - git://aeb41b9d8 - the change that removed `Start.getAutoApproval` from every backend
  - "[code://packages/sdk/src/host/permissions.ts#L105-L124](../../../../packages/sdk/src/host/permissions.ts#L105-L124) - `alwaysAsks`, the host's reading of `eligibleForAutoApproval`, which the check reuses"
  - "[code://packages/sdk/src/types/agent.ts#L270](../../../../packages/sdk/src/types/agent.ts#L270) - `Start`, where the check goes"
  - "[code://packages/sdk/src/types/agent.ts#L328](../../../../packages/sdk/src/types/agent.ts#L328) - `Start.managedSettings`, which hands the rule under either value of `managedRules`"
  - "[code://packages/sdk/src/host/spawn.ts#L1305](../../../../packages/sdk/src/host/spawn.ts#L1305) - where the host builds a backend's `Start`"
  - "[code://packages/agent-claude/src/session/asking.ts#L397-L399](../../../../packages/agent-claude/src/session/asking.ts#L397-L399) - a host tool with `confirm: false` is allowed before any question"
  - "[code://packages/agent-pi/src/session.ts#L549-L580](../../../../packages/agent-pi/src/session.ts#L549-L580) - `decide`, which reads the mode and not the rule"
  - "[code://packages/agent-cofold/src/turnagent.ts#L393-L397](../../../../packages/agent-cofold/src/turnagent.ts#L393-L397) - `beforeTool`, which allows every call"
  - "[code://packages/agent-claude/test/agent-claude-questions.test.ts](../../../../packages/agent-claude/test/agent-claude-questions.test.ts) - Claude's question cases"
  - "[code://packages/agent-pi/test/agent-pi-asking.test.ts](../../../../packages/agent-pi/test/agent-pi-asking.test.ts) - pi's question cases"
  - "[code://packages/agent-cofold/test/agent-cofold-questions.test.ts](../../../../packages/agent-cofold/test/agent-cofold-questions.test.ts) - cofold's question cases"
---

## Goal

A tool the operator sets `false` in `eligibleForAutoApproval` asks every time, in every backend and every mode, under `managedRules: checked`.
Today a Claude host tool with `confirm: false` runs with no question.
pi and cofold settle a call in some modes before the host sees it.
Under `managedRules: handed` nothing changes: the host hands the rule to the runtimes, as VS Code does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The reproduction is in the problem file at `git://657b43e23`: with `host/list_bash` set `false`, Claude ran `mcp__host__list_bash` with no question, and `host/list_sessions`, also `false`, asked.

### Searches performed

- `git show aeb41b9d8^:packages/sdk/src/types/agent.ts` - `Start.getAutoApproval` answered `ask` for a tool the rule names, and each backend read it first.
- `rg "confirm: false" packages/sdk/src/tools` - only the shell tools, offered when `enableCustomTerminalTool` is on.
- `rg "alwaysAsks" packages/sdk/src` - the host's one reading of the rule, by tool name, contributor and the session's customizations.

### Runtime path

```
backend about to run a call -> Start.alwaysAsks(toolName, contributor) -> true -> the backend raises a question to the host
  -> the host puts it with Allow Once and Skip alone, as today -> dontAsk refuses it instead
false or absent -> the backend's mode and confirm: false, as today
```

### Gaps

- `Start` carries no check.
- Claude allows a `confirm: false` host tool first.
- pi's `decide` and cofold's `beforeTool` read no rule.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Under `managedRules: checked` each backend reads a per-call check, as `getAutoApproval` at `e388d12f5` | Softov, 2026-11-08: "Per call under checked" | 01, 02, 03 |
| A matched call asks in every mode, and `dontAsk` refuses it | Softov, 2026-11-08, in the problem file | 02, 03 |
| Under `managedRules: handed` the host sets no check, and no backend checks | Softov, 2026-11-08, in the problem file | 01 |
| The check is `Start.alwaysAsks(toolName, contributor?)`, and the host answers it with `alwaysAsks` | (defaulted: the host's function already reads the rule, and one reading keeps backends and host in agreement) | 01 |
| The check covers `eligibleForAutoApproval` only; the managed `ask` rules keep their path | (defaulted: the problem names the per-tool rule) | 01 |
| The docs say what `false` means under each value of `managedRules` | Softov, 2026-11-08, in the problem file | 04 |
| A mode that refuses a call the rule names, such as `plan` for a write, still refuses it | (defaulted: a refusal holds more back than a question) | 03 |
| cofold clears its remembered approval for a tool the rule names | (defaulted: cofold reads that approval after the policy, and nothing else can stop it settling the call) | 03 |

## Proposed architecture

- **Data flow** - The host builds `Start.alwaysAsks` from `alwaysAsks` and the session's bound tools. Each backend calls it before its own decision.
- **State flow** - No new state. cofold's remembered approval stays, and the check runs before it.
- **Layer responsibilities** - sdk: the check on `Start` · agent-claude, agent-pi, agent-cofold: read it first · docs: what `false` means.
- **Source-of-truth files** - [`code://packages/sdk/src/host/permissions.ts`](../../../../packages/sdk/src/host/permissions.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the start carries the check](task-01-the-start-carries-the-check.md) | done | - |
| [02 - claude asks about a named host tool](task-02-claude-asks-about-a-named-host-tool.md) | done | 01 |
| [03 - pi and cofold ask in every mode](task-03-pi-and-cofold-ask-in-every-mode.md) | done | 01 |
| [04 - the docs say what false means](task-04-the-docs-say-what-false-means.md) | done | 02, 03 |

## Risks and tradeoffs

- An ACP agent settles its own calls in some modes too - the problem names three backends, and ACP stays as it is.
- A backend names a tool its own way - the check takes that name, and `alwaysAsks` reads a host tool by its suffix.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 to 04 built on 2026-11-16 on branch `host/20261116-2128-backends-ask-what-the-operator-asks`, from the branch of host/20261116-2126, awaiting review.
- **Next action:** Softov reviews the PR, then the checks of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** an sdk host change runs the computer suite too; each backend's suite runs on its own.

## Final verification checklist

- [x] The sdk, computer, agent-claude, agent-pi and agent-cofold suites pass, one at a time.
- [x] On the test daemon, `mcp__host__list_bash` set `false` asks in a Claude session.
