---
title: A Claude question allows a typed answer, where VS Code's Claude allows none
status: accepted
date: 2026-11-21
refs:
  - "[code://packages/agent-claude/src/input.ts#L107](../../packages/agent-claude/src/input.ts#L107) - each question's `allowFreeformInput`"
  - "[code://packages/agent-claude/src/session/asking.ts#L583-L589](../../packages/agent-claude/src/session/asking.ts#L583-L589) - a typed answer joined into what the tool is handed"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/claude/claudeInteractiveTools.ts` L113 and L121, `allowFreeformInput: q.allowFreeformInput ?? false`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.325 - `sdk-tools.d.ts`, the `AskUserQuestion` options, "There should be no 'Other' option, that will be provided automatically."
---

## Context

Claude's `AskUserQuestion` tool tells the model that an Other choice is provided automatically, so the model lists only its own options. The input has no `allowFreeformInput` field. VS Code's Claude reads that missing field as `false`, and ahpd copied it, so a person can only pick one of the model's options. The answer path already carries typed words: `freeformValues` are joined into the answer the tool is handed.

## Decision

Every question of a Claude `AskUserQuestion` goes out with `allowFreeformInput: true`, unless its input says `false`.

## Consequences

- A person whose answer is not among the options can type it, as the SDK promises the model.
- A client that draws a text box for `allowFreeformInput` shows one on every Claude question.
- ahpd departs from VS Code main here. A later parity pass keeps this departure, and checks whether VS Code changed its default.

## Options

- **Keep VS Code's `false`.** Lost: the model is told an Other is offered when it is not.
- **A record setting, defaulting to `true`.** Lost: a setting for a choice few hosts would change, and no host needs the VS Code behaviour.
