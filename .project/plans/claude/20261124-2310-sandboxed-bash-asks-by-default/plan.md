---
title: A sandboxed Bash command asks by default
domain: claude
status: active
priority: medium
created: 2026-11-24
revalidated: 2026-11-24
refs:
  - git://5952ade57 - the last commit that holds `ideas/sandboxed-bash-asks-as-the-sdk-default.md`, which this plan replaces
  - "[code://packages/agent-claude/src/options.ts#L38-L56](../../../../packages/agent-claude/src/options.ts#L38-L56) - the `sandbox` option, which also sends `autoAllowBashIfSandboxed`"
  - "[code://packages/agent-claude/src/options.ts#L588-L593](../../../../packages/agent-claude/src/options.ts#L588-L593) - `through`, which joins the options one level deep"
  - https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md - 0.3.325 approves no sandboxed Bash command unless `autoAllowBashIfSandboxed` is set
---

## Goal

With a Claude record's sandbox on, a sandboxed Bash command asks as any other command does. A record option lets it run without a question, as before.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n autoAllowBash packages` - one place sends it, and cases in agent-claude and the sdk expect it.

### Runtime path

```
record option -> declared values -> toQuery -> query settings -> the CLI's permission flow
```

### Gaps

- Nobody can have the sandbox on and be asked.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A setting, with the SDK's behaviour as its default | Softov, 2026-11-24, chose "A setting, default as the SDK" | 01 |
| The option has the SDK's name, `autoAllowBashIfSandboxed`, a boolean of the record | `(defaulted: the SDK's word for it)` | 01 |
| A record that does not name it sends nothing, so the settings files decide | `(defaulted: as sandbox's own default does)` | 01 |
| With sandbox off it sends nothing | `(defaulted: no command is sandboxed)` | 01 |

## Proposed architecture

- **Layer responsibilities** - agent-claude: the option, and a join that keeps both sandbox keys.
- **Source-of-truth files** - [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the option decides](task-01-the-option-decides.md) | done | - |

## Risks and tradeoffs

- A session that ran with the sandbox on starts to ask after the upgrade - the release notes say it and name the option.
- A session under `dontAsk` has such a command denied - a case covers it, and the option's text says it.

## Resume state

- **Done so far:** task 01, 2026-11-24.
- **Next action:** the review.
- **Open questions:** none.
- **Watch out for:** two options that both answer `settings` replace each other in `through`.

## Final verification checklist

- [x] The whole suite passes.
- [x] With the real CLI and the sandbox on, a Bash command asks; with the option on it does not.
