---
title: The session tools take model and display options
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/host/20261121-0524-the-small-vscode-main-fixes/plan.md
refs:
  - git://fd7084712 - main when the plan was made
  - git://8b6842e2c - the last commit that holds `briefs/vscode-main-parity-after-ahp-1-1-0.md`, the facts, section *Session tool options*
  - "[code://packages/sdk/src/tools/session.ts#L595-L615](../../../../packages/sdk/src/tools/session.ts#L595-L615) - `create_session`, which takes `model`, `agent` and `config`"
  - "[code://packages/sdk/src/tools/session.ts#L741](../../../../packages/sdk/src/tools/session.ts#L741) - `list_models`"
  - "[code://packages/sdk/src/tools/artifacts.ts#L94](../../../../packages/sdk/src/tools/artifacts.ts#L94) - one entry of `add_artifact_or_reference`"
  - "[code://packages/agent-claude/src/claude.ts#L307-L320](../../../../packages/agent-claude/src/claude.ts#L307-L320) - a Claude model's own `configSchema` with its effort"
  - npm://@microsoft/agent-host-protocol@1.1.0 - `ModelSelection.config`, the model's own values
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/shared/sessionServerTools.ts` L135-L192 and L1020-L1110, `node/shared/artifactServerTools.ts` L45-L53 and L243
---

## Goal

`create_session` takes `reasoningEffort` and `contextTier` while the root key `sessionModelOptions` is not `off`, as VS Code main does.
`list_models` says each model's efforts and context tier then.
`add_artifact_or_reference` takes `mode`, `pinned` or `aboveInput`, while `chatResources` is on.
With both keys at their defaults, nothing changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Build the session tool options | Softov, 2026-11-21, chose "Session tool options" | 01, 02, 03 |
| The two options are offered and read only while `sessionModelOptions` is `inline` or `tool` | (defaulted: VS Code `sessionServerTools.ts` L135, L961-L962) | 01 |
| An option is checked against the chosen model's `configSchema`, and refused in VS Code's words | (defaulted: VS Code `resolveCreatedModelSelection`) | 01 |
| The checked values go on the new chat's `ModelSelection.config` | (defaulted: AHP 1.1.0 `ModelSelection.config`; VS Code `withExplicitModelConfiguration`) | 01 |
| The `config` input ahpd already takes stays beside the two options | (defaulted: it sets an agent's settings, not a model's values) | 01 |
| `contextTier` needs a model whose context size property has more than one value; no ahpd backend has one, so it is refused for each | (defaulted: VS Code's refusal for a single context window) | 01 |
| `list_models` lists the options when `sessionModelOptions` is `tool` | (defaulted: VS Code `sessionServerTools.ts` L379, L1092-L1110) | 02 |
| `inline` lists them in `create_session`'s description, since ahpd has no tool search | (defaulted: VS Code lists them when the tool is loaded through tool search) | 02 |
| `mode` is offered while `chatResources` is on; without it a `mode` sent anyway is ignored, even an invalid one | (defaulted: VS Code `artifactServerTools.ts` L243) | 03 |
| An artifact keeps its `mode` and a `modeRevision` that moves on each change | (defaulted: VS Code's artifact collection) | 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - create_session takes model options](task-01-create-session-takes-model-options.md) | done | - |
| [02 - list_models says each model's options](task-02-list-models-says-each-models-options.md) | done | 01 |
| [03 - An artifact takes a mode](task-03-an-artifact-takes-a-mode.md) | done | - |

## Risks and tradeoffs

- `reasoningEffort` and the `config` input's `effortLevel` both reach Claude's effort. The model's value is the more specific one, as the model's `configSchema` is read after the session's.
- The window draws `mode` only where it reads the artifact's field. Task 03 checks what VS Code's window reads before the field is named.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [x] A test: with `sessionModelOptions` `off`, `create_session` offers and reads neither option.
- [x] A test: a supported `reasoningEffort` reaches the new chat's model config, and an unsupported one is refused in VS Code's words.
- [x] A test: `list_models` says a model's efforts with `tool`.
- [x] A test: `mode` is kept with `chatResources` on and ignored with it off.
- [x] The gates pass: typecheck, boundary, schema and the sdk suite.
