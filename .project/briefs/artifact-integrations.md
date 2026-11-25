---
title: Artifact integrations
created: 2026-11-21
refs:
  - git://8a5a86a5c - main when the facts were checked
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](vscode-methods-ahpd-does-not-serve.md) - group *Artifact integrations*"
  - "[code://packages/sdk/src/tools/artifacts.ts#L21-L23](../../packages/sdk/src/tools/artifacts.ts#L21-L23) - the artifact types a session records"
  - "[code://packages/sdk/src/host.ts#L102](../../packages/sdk/src/host.ts#L102) - Agent Merge, which VS Code turns off while integrations are on"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L242-L246](../../packages/sdk/src/vscoderootconfig.ts#L242-L246) - `artifactIntegrations`, mirrored and read by nothing"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `ARTIFACT_INTEGRATIONS_PROPOSAL.md`, 1,207 lines; `common/clientArtifactIntegrations.ts`, the client channel; `node/artifactIntegrations/`, the host side
---

# Artifact integrations

Softov wants VS Code's artifact integrations researched, then planned, so ahpd serves the five `vscode/*artifactIntegrations*` methods. An integration enriches an artifact a session recorded, such as a pull request, with live state, actions and opt-in automation. He chose a brief before any plan because the proposal is a framework, not two methods.

## What others do

- **VS Code** gates the feature by `chat.artifactIntegrations.enabled`: on by default in Insiders, off in Stable.
  - While it is on, Agent Merge is off, without its saved choices being rewritten.
  - The pieces are an artifact record, an integration resource model, a session binding, and one coordinator that runs every action through a durable ledger.
- Agents reach integrations through four server tools: `get_artifact_status`, `run_artifact_action`, `set_artifact_automation` and `disable_artifact_automation`. The last three run only in a turn that traces back to a person or a scheduled automation.
- A client offers its own integrations through `vscode/clientArtifactIntegrations/register`. It serves the host's `vscode/clientArtifactIntegrations` requests and sends `vscode/clientArtifactIntegrations/update`. The host's own go through `vscode/artifactIntegrations` and `vscode/artifactIntegrations/update`.
- The built-in integration is GitHub pull requests: checks, review threads, Fix CI, Address Reviews, Resolve Conflicts, Mark Ready and Merge. Automatic repair and merge need consent.

## What ahpd has today

- A session records artifacts of six types, `pullRequest` among them ([`code://packages/sdk/src/tools/artifacts.ts#L21`](../../packages/sdk/src/tools/artifacts.ts#L21)).
- Agent Merge runs repairs on a pull request ([`code://packages/sdk/src/host.ts#L102`](../../packages/sdk/src/host.ts#L102)).
- The root setting `artifactIntegrations` is mirrored, off by default, and nothing reads it.
- No integration, ledger, consent, or integration tool.

## Who writes

- `packages/sdk/src/host/agentmerge.ts` and `packages/sdk/src/tools/artifacts.ts`: no open plan or branch changes them now.

## The change

- The facts this brief still needs come first: the proposal's contracts, VS Code's host side, and ahpd's Agent Merge, compared point by point.
- Plans follow, each one feature.
- While the root setting `artifactIntegrations` is on, Agent Merge does not run, and its saved choices stay as they are. Softov, 2026-11-22, "Off while integrations on (Recommended)".
- The GitHub integration is new code built to VS Code's integration model, and Agent Merge stays as it is. Softov, 2026-11-22, "New code as VS Code's".

## Open points

- Not asked yet: which parts come first.
- Each is to be asked before this brief is final.
