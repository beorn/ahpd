---
title: Agent extensions are a session's plugins
created: 2026-11-21
refs:
  - git://8a5a86a5c - main when the facts were checked
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](vscode-methods-ahpd-does-not-serve.md) - group *Agent extensions*"
  - "[briefs/plugins-are-a-sessions-extensions.md](plugins-are-a-sessions-extensions.md) - the plugin brief this one waits on"
  - "[code://packages/sdk/src/plugins/enablement.ts](../../packages/sdk/src/plugins/enablement.ts) - plugins on or off by global, folder and session scope"
  - "[code://packages/agent-claude/src/session/customizations.ts#L21-L23](../../packages/agent-claude/src/session/customizations.ts#L21-L23) - Claude plugins shown as customizations, each with a toggle"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agent.ts#L368-L396`, the inventory types; `node/protocolServerHandler.ts#L4392-L4433`, the two methods; `node/agentService.ts#L7146-L7166`, served by Copilot only; `node/copilot/copilotExtensionTools.ts`, `extensions_reload`
---

# Agent extensions are a session's plugins

Softov wants VS Code's `vscode/listAgentExtensions` and `vscode/setAgentExtensionEnabled` served by ahpd, with ahpd's plugins as the extensions. In his words, an agent extension is "a view of what plugins add. Or it can be the plugin already." The plugins this needs are the subject of their own brief, [plugins-are-a-sessions-extensions.md](plugins-are-a-sessions-extensions.md), and this brief waits on it.

## What others do

- **VS Code** lists Copilot CLI's executable extensions: programs Copilot starts for a session, from the user's folder, the project, or a plugin. They add tools and canvases, and the agent can write one and reload it with `extensions_reload`.
- `listAgentExtensions {session?, chat?}` answers `{mode, extensions: [{id, name, resource?, source, status, pluginName?}]}`.
  - `mode` is `disabled`, `load_only`, `load_and_augment` or `unknown`.
  - `source` is `user`, `project` or `plugin`.
  - `status` is `running`, `dormant`, `disabled`, `failed`, `starting` or `unknown`; only a live session reports more than `unknown`.
- `setAgentExtensionEnabled {extensionId, enabled, session?, chat?}` turns one on or off, and is refused on a read-only connection.
- Only Copilot serves them. Without a session they go to Copilot; with one, to the chat's own agent. Claude and Codex answer that the inventory is unavailable.

## What ahpd has today

- No method of the two.
- Plugins turn on and off by global, folder and session scope, VS Code's order ([`code://packages/sdk/src/plugins/enablement.ts`](../../packages/sdk/src/plugins/enablement.ts)).
- Claude's own plugins show as customizations in the window, each with its toggle.
- A plugin can register host tools (`registerTool`, [`code://packages/sdk/src/types/plugin.ts#L1319`](../../packages/sdk/src/types/plugin.ts#L1319)).

## Who writes

- `packages/sdk/src/host/vscodemethods.ts`, `gate.ts` and `handshake.ts`: the eleven `20261121-2250` plans add to them. A plan from this brief starts after those builds.

## The change

- The two methods answer ahpd's plugins in VS Code's shape. One entry is one ahpd plugin a session or chat can load, such as `computer` or `push`. Agent plugins are not entries, since the Plugins page lists them, as [the research note](../research/vscode-extensions-plugins-and-customizations.md) explains. Softov, 2026-11-22, "one row per plugin" and "ahpd plugins (Recommended)".
- `source` says where the plugin came from: the user's, the project's, or another plugin's.
- `status` comes from the plugin's live state in the session, as the plugin brief defines it.
- `setAgentExtensionEnabled` sets the session's or chat's own decision in `enablement.ts`.
- `mode` says how the host loads plugins, as [plugins-are-a-sessions-extensions.md](plugins-are-a-sessions-extensions.md) maps it. `disabled` is the plugin off, and `load_only` is the plugin running with its tools off. `load_and_augment` is the plugin with its tools on.

## Open points

- Not checked: how Copilot acts on `load_only` against `load_and_augment`, from which the mapping in *The change* was read.
