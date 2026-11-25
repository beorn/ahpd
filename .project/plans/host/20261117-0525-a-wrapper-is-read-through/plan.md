---
title: A wrapper command is read through to the command it runs
domain: host
status: built
priority: high
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - git://0e516ea79 - the last commit that holds `problems/a-grant-on-a-wrapper-command-approves-any-command.md`, with its reproduction of 2026-11-17
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L776-L792](../../../../packages/sdk/src/access/commandautoapprover.ts#L776-L792) - each command of a line is matched as written, so `command rm` is not `rm`"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L534](../../../../packages/sdk/src/access/commandautoapprover.ts#L534) - `TRANSIENT_VARIABLE`, the check that `env A=1 make` reaches once `env` is read through"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L1015-L1021](../../../../packages/sdk/src/access/commandautoapprover.ts#L1015-L1021) - `NEVER_AUTO_APPROVE_COMMANDS`, the commands a grant never names"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L1032](../../../../packages/sdk/src/access/commandautoapprover.ts#L1032) - `suggestAutoApproveRuleKeys`, the keys a grant offers"
  - "[code://packages/sdk/src/host/permissions.ts#L645-L646](../../../../packages/sdk/src/host/permissions.ts#L645-L646) - a question offers keys for the commands no rule approved"
  - "[code://packages/sdk/test/commandautoapprover.test.ts](../../../../packages/sdk/test/commandautoapprover.test.ts) - the cases of the approver"
  - "[code://docs/server/CONFIGURE.md#L146](../../../../docs/server/CONFIGURE.md#L146) - *Terminal rules*, where the docs say how a command is matched"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/terminal/common/autoApprove/suggestAutoApproveRules.ts#L11-L21 - VS Code's list has the same gap, so this plan departs from it
---

## Goal

A wrapper command runs the command after it, so the rules judge that command.
`command rm -rf x` is denied as `rm -rf x` is, whatever allow rule names `command`.
`timeout 60 npm test` is approved by `Shell(npm test)`.
No grant names a wrapper, so a saved rule such as `Shell(command *)` approves nothing that its inner command does not.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The reproduction is in the problem file at `git://0e516ea79`.

### Searches performed

- `rg "'command'|'env'|'timeout'|'nohup'" packages/sdk/src/access` - no wrapper is read through, and none is in the list a grant never names.
- `rg "xargs" packages/sdk/src/access/commandautoapprover.ts` - the table denies `xargs`, so it stays out of this plan.

### Runtime path

```
line -> split into commands -> each command read through its wrappers -> classify, deny table, allow rules on the inner command
unapproved inner commands -> suggestAutoApproveRuleKeys -> grant keys, never a wrapper
```

### Gaps

- A rule or the table matches the wrapper, not the command it runs.
- A grant may name a wrapper, which approves any command after it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Rules and the deny table judge the command a wrapper runs, and no grant names a wrapper | Softov, 2026-11-17: "Read through the wrapper" | 01 |
| The wrappers are `command`, `builtin`, `exec`, `env`, `nice`, `nohup`, `time`, `timeout`, `stdbuf`, `setsid` and `ionice` | (defaulted: each runs the command after it; `xargs` the table already denies) | 01 |
| A wrapper nests, so `nice nohup rm x` is read as `rm x` | (defaulted: each wrapper is read in turn) | 01 |
| `command -v` and `command -V` run nothing, and are not read through | (defaulted: they only look a name up) | 01 |
| `env` keeps its `A=1` assignments, so the transient variable check applies as for `A=1 make` | (defaulted: the same command, the same answer) | 01 |
| A wrapper with an option not read, or with no command after it, asks and offers no grant | (defaulted: a command not read is not approved) | 01 |
| Bash family only; PowerShell has no wrapper here | (defaulted: none of the list is a PowerShell command) | 01 |
| A `permissions` deny rule matches a command as written and as the command its wrappers run | (defaulted: the answer of 2026-11-17 names the rules, and `isDeniedByPermissions` is a second entry point) | 01 |
| The docs and the 0.15 notes say how a wrapper is read | (defaulted: a rule that matched before may match less now) | 02 |

## Proposed architecture

- **Data flow** - `evaluation` reads each split command through `innerCommand` before `classify`, the deny table and the allow rules. The inner command goes into `unapprovedSubCommands`, so the grant keys name it.
- **State flow** - none. Saved rules stay as they are and match the inner command.
- **Layer responsibilities** - sdk: `commandautoapprover.ts`, and `isDeniedByPermissions` in `permissions.ts` · docs: `CONFIGURE.md` and `v0_15.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/access/commandautoapprover.ts`](../../../../packages/sdk/src/access/commandautoapprover.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the approver reads through a wrapper](task-01-the-approver-reads-through-a-wrapper.md) | done | - |
| [02 - the docs say how a wrapper is read](task-02-the-docs-say-how-a-wrapper-is-read.md) | done | 01 |

## Risks and tradeoffs

- A wrapper not on the list keeps the gap - it also goes into `NEVER_AUTO_APPROVE_COMMANDS` when it is added, so no grant names it.
- A saved rule that names a wrapper, such as `Shell(timeout *)`, approves less than before - the 0.15 notes say so.
- This departs from VS Code, which has the same gap - the plan names the reference it departs from.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 and 02 are `implemented` on 2026-11-17, on the branch `host/20261117-0525-a-wrapper-is-read-through`.
- **Next action:** Softov's review, then the checks of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** `commandParser` may hand in its own split, so the reading through goes after the split, not inside `splitCommand`.

## Final verification checklist

- [x] With `Shell(command *)` in a person's rules, `command rm -rf x` asks and offers no grant, on the test daemon.
- [x] With `Shell(npm test)`, `timeout 60 npm test` runs with no question.
- [x] A question on `timeout 60 make` offers `make`, never `timeout`.
- [x] The sdk, computer and agent-acp suites pass.
