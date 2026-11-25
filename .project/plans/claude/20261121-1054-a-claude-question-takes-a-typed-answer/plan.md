---
title: A Claude question takes a typed answer
domain: claude
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
decisions:
  - decisions/a-claude-question-allows-a-typed-answer.md
refs:
  - git://1f915784a - main when the plan was made
  - git://cea147af8 - the last commit that holds the brief `a-claude-question-takes-a-typed-answer.md`
  - "[code://packages/agent-claude/src/input.ts#L107](../../../../packages/agent-claude/src/input.ts#L107) - each question's `allowFreeformInput`, `false` unless the input says `true`"
  - "[code://packages/agent-claude/src/session/asking.ts#L583-L589](../../../../packages/agent-claude/src/session/asking.ts#L583-L589) - a typed answer joined into what the tool is handed"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts#L798-L815](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts#L798-L815) - the case that pins the flag"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.325 - `sdk-tools.d.ts`, the `AskUserQuestion` options, "There should be no 'Other' option, that will be provided automatically."
---

## Goal

A person answering a Claude question can type an answer of their own, as Claude's SDK promises the model. Today every Claude question is sent with `allowFreeformInput: false`, so only the model's options can be picked.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "allowFreeformInput" packages/` - `agent-claude/src/input.ts` sets it; cofold and the host's own question tool send `false` only where their question forbids a typed answer.

### Runtime path

```
AskUserQuestion -> questionRequest -> chat/inputRequested -> a client's answer with freeformValues -> the tool's answers
```

### Gaps

- `questionRequest` sends `false` for every question that does not say `true`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A Claude question allows a typed answer by default | Softov, 2026-11-21, chose "Allow free text by default"; [decision](../../../decisions/a-claude-question-allows-a-typed-answer.md) | 01 |
| A question whose input says `allowFreeformInput: false` keeps it | (defaulted: the input's own word wins, as cofold and the host's tool do) | 01 |
| A question restored from a transcript takes the same flag | (defaulted: one builder makes both) | 01 |

## Proposed architecture

- **Data flow** - `questionRequest` sends `allowFreeformInput: question.allowFreeformInput !== false`.
- **Layer responsibilities** - agent-claude: the flag. The answer path is unchanged.
- **Source-of-truth files** - [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A question allows a typed answer](task-01-a-question-allows-a-typed-answer.md) | done | - |

## Risks and tradeoffs

- ahpd departs from VS Code main here, as the decision records. A later parity pass keeps the departure.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: a question with no flag allows a typed answer, and one with `false` does not.
- [x] A test: a typed answer reaches the tool's answers.
- [x] The gates pass: typecheck and the agent-claude suite.
