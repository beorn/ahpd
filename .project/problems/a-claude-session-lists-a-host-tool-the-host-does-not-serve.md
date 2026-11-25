---
title: A Claude session lists a host tool the host does not serve
status: open
date: 2026-11-23
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L578-L609](../../packages/sdk/src/host/tooling.ts#L578-L609) - the artifact tools are served only while the root setting `artifactTools` is true"
  - "[code://packages/sdk/src/tools/server.ts#L40-L49](../../packages/sdk/src/tools/server.ts#L40-L49) - `notify` and `list`, the two ways a backend hears that its tools changed"
  - "[code://packages/sdk/src/tools/server.ts#L353-L362](../../packages/sdk/src/tools/server.ts#L353-L362) - `list` is the default when a backend names neither"
  - git://5d71adf7f - main when the problem was read
---

## Symptom

Seen on 2026-11-23 in Softov's dev daemon, session `ahp-session:/0db7b399-3b97-4305-9f30-d9938655c09f`, a Claude session.
The root setting `artifactTools` was off, so the host did not serve the artifact tools.
The agent still had `add_artifact_or_reference` in its tool list, and called it.
Claude Code refused the call: "No such tool available: mcp__host__add_artifact_or_reference. Its MCP server 'host' is connected but does not offer this tool here."
The agent also said that `list_artifacts_and_references` and `remove_artifact_or_reference` had stopped being offered earlier in the session.
With `artifactTools` on, a new session `f9893778-1bc6-4446-beba-d90b55d4ba00` recorded the same six items.

## Cause

Not known. Two causes fit, and neither is checked:

- The agent's list is stale. ahpd's tool server tells a backend of a changed list only in `notify` mode. The default is `list`, where the backend finds the change at its next `tools/list`. If `artifactTools` changed during the session, Claude kept the names from its first list.
- Claude Code lists deferred tool names by itself, from a list it read once, and only checks them at the call.

Check which tool-change mode the Claude backend uses, and whether Claude Code reads `tools/list` again after the session starts.

## Impact

An agent sees a tool that it cannot call, and spends a call to find that out.
The same thing can happen to any host tool that a root setting turns on or off during a session.
