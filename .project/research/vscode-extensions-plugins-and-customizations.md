---
title: VS Code's extensions, plugins and customizations, and what ahpd serves of them
date: 2026-11-22
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - the VS Code source read for this note
  - git://github.com/microsoft/vscode@1564f100807a - `src/vs/platform/agentHost/ARTIFACT_INTEGRATIONS_PROPOSAL.md`; `node/shared/artifactIntegrationServerTools.ts`, the four tools; `node/artifactIntegrations/githubPullRequestArtifactIntegration.ts`, the pull request integration
  - git://102bf32b2 - ahpd main when this note was written
  - "[code://packages/sdk/src/plugins/enablement.ts](../../packages/sdk/src/plugins/enablement.ts) - ahpd's on/off decisions per scope"
  - "[code://packages/sdk/src/host/actions.ts#L976-L1030](../../packages/sdk/src/host/actions.ts#L976-L1030) - `session/activeClientSet`, where a client's tools and plugins arrive"
  - "[briefs/agent-extensions-are-a-sessions-plugins.md](../briefs/agent-extensions-are-a-sessions-plugins.md) - the agent extensions brief"
  - "[briefs/artifact-integrations.md](../briefs/artifact-integrations.md) - the artifact integrations brief"
---

# VS Code's extensions, plugins and customizations

VS Code has two windows on one agent host. The VS Code window is the editor, with Chat on its side. The Agents window, which VS Code's source calls Sessions (`src/vs/sessions`), is a window built around agent sessions. Both reach the agent host through the same protocol client, and both open the same Customizations page.

Six things have similar names. Each one lives in a different place, and a different part turns it on or off.

| Thing | What it is | Where it lives | Who turns it on or off | What ahpd serves |
| --- | --- | --- | --- | --- |
| VS Code extension | A VS Code add-on from the Marketplace | VS Code, on your computer | You, per window | Nothing: the host never sees it |
| Agent plugin | A package of skills, agents, hooks, commands and MCP servers for the agent | Your computer or the session's folder | You, per session, folder or everywhere | Yes, as session customizations |
| Customization | One item the agent uses: a plugin, MCP server, skill, instruction, agent, hook or tool | The session's state on the host | You, per session, folder or everywhere | Yes |
| ahpd plugin | A package the daemon loads, such as `@ahpd/computer` | The daemon | The daemon's configuration | Its tools and agents show; the plugin itself does not |
| Agent extension | A program Copilot CLI starts beside a chat, which can add tools or canvases | Copilot's folders, or a plugin | You, per session or chat | Not yet: an open brief |
| Artifact integration | Live status, actions and automation on something a session recorded, such as a pull request | The host | A root setting, and consent per automation | Not yet: an open brief |

## VS Code extensions

A VS Code extension is an add-on you install in VS Code, such as C/C++, Python or GitLens. It runs in VS Code's own extension host on your computer. The agent host never sees it.

The Agents window lists the extensions installed in VS Code under Customizations, Extensions. VS Code says: "Enabling or disabling an extension here only affects the Agents window." The switch is per window. It is not per session, and VS Code keeps it.

The list has three groups:

- **AI Features** - extensions that add tools, MCP servers or skills but did not declare support for the Agents window. They are off by default.
- **Supported** - extensions that declared support for the Agents window. They are on by default.
- **Other Extensions** - the rest, off by default, because they might not work there.

An extension that adds views, debuggers, status bar items or walkthroughs has a warning, since the Agents window does not have those.

## Agent plugins

An agent plugin is a package that adds commands, skills, agents, hooks and MCP servers to the agent, in the [Open Plugins](https://open-plugins.com/) format. VS Code says: "Extend your AI agent with plugins that add commands, skills, agents, hooks, and MCP servers from reusable packages." It is not a VS Code extension.

- **User** plugins are on your computer, under `~/.vscode/agent-plugins`, installed from a marketplace such as `github/awesome-copilot`. The VS Code window's Extensions view lists them under "Agent Plugins - Installed".
- **Workspace** plugins belong to the session's folder. Not checked: where in the folder VS Code and ahpd look for them.

How a user plugin reaches the agent: the window sends it to the host in `session/activeClientSet`, in the session's `activeClient.customizations`. The host then lists it in the session's customizations, with the `clientId` of the window that sent it. A plugin on your computer therefore reaches only the sessions your window is in.

How to work with them: open Customizations, Plugins. Each row has a switch. Browse, or Add Customization, Add Plugin, installs one.

## Customizations

Customizations is the page that both windows open for one session, titled with the session's agent and host, such as "Customizations (Claude Code · ahpd)". Every item on it except Extensions comes from the host, from the session's state.

| Section | What it lists |
| --- | --- |
| Browse | Searches marketplaces and Copilot Connectors, and installs or connects. Add Customization makes a new agent, skill or instructions file, or adds an MCP server or a plugin. |
| Plugins | The agent plugins the session can load. |
| MCP Servers | The session's MCP servers, from its plugins and its configuration. |
| Skills | The skills the agent can use. |
| Instructions | The instruction files the agent reads, such as `CLAUDE.md`. |
| Agents | The subagents the session's agent can start. |
| Hooks | The hooks that run on the agent's events. |
| Tools | The tools the agent can call. |
| Extensions | The VS Code extensions for the Agents window, as *VS Code extensions* says. Not from the host. |

A switch on a host item is a decision at one scope: global, folder or session. The most specific decision wins: the session's, then the folder's, then the global one. An item nobody decided about is on. ahpd keeps the global and folder decisions across sessions in `enablement.ts`, and the session's own in the session.

## ahpd plugins

An ahpd plugin is a package the daemon loads at start, such as `@ahpd/computer`, `@ahpd/push` or an agent backend. It adds to the daemon: tools, agents, channels, commands and settings. The daemon's configuration decides which ones load.

VS Code has no page for ahpd plugins. What they add shows where it belongs: a tool on the Tools page, an agent in the agent picker. An ahpd plugin is not an agent plugin, although both are called plugins.

## Agent extensions

An agent extension is a program that Copilot CLI starts for a session. It comes from your folder, the project, or an agent plugin. It can give the agent tools and canvases, and the agent can write one and reload it.

- VS Code reads them with `vscode/listAgentExtensions`, and turns one on or off with `vscode/setAgentExtensionEnabled`, for a session or a chat.
- VS Code draws them on the Customizations page, in the Canvases section, as canvas extensions. A row can open its plugin's details.
- Only Copilot serves them. Claude and Codex answer that the list is unavailable.

ahpd serves neither method. The brief [agent-extensions-are-a-sessions-plugins.md](../briefs/agent-extensions-are-a-sessions-plugins.md) asks what one row is in ahpd, and that question is open.

## Artifact integrations

A session records artifacts and references, such as a pull request it opened, with `add_artifact_or_reference`. VS Code lists each one as a row in the Artifacts or References pill, with its label and a link. A recorded entry is only a note: "this session points at this". It has no live state and no actions.

An artifact integration is code that matches recorded entries by URI and follows the real thing behind them. VS Code's words: integrations "enrich resources that have already been recorded; they do not produce the artifacts, own their records, or supply their UI."

What an integration does:

1. It matches a recorded entry by URI, such as "this link is a GitHub pull request".
2. It watches the real thing, such as the pull request's checks, review threads and merge state.
3. It sends VS Code an icon, a label, sections and actions. VS Code draws them; the integration draws nothing.
4. It runs actions. A `code` action changes the real thing, such as Merge. A `prompt` action sends the agent a prompt in the chat, such as Fix CI. One executor records every run, so nothing runs twice.
5. It offers automation that a person or an agent turns on, such as "merge when green". Automation starts off, needs consent, and has a limit of attempts.

Where integrations come from:

- The host. The GitHub pull request integration is the only one built in.
- A VS Code extension, with `chat.registerArtifactIntegrationProvider`.
- A client that offers its own to the host, with `vscode/clientArtifactIntegrations/register`.

The setting `chat.artifactIntegrations.enabled` turns them on: on by default in Insiders, off in Stable. While it is on, Agent Merge is off. Recording entries is a separate setting, `chat.artifactTools.enabled`, which ahpd mirrors as the root key `artifactTools`.

### The agent's four tools

| Tool | What it does |
| --- | --- |
| `get_artifact_status` | Reads, and never changes anything. With no artifact, it lists the recorded entries that have an integration. With one, it answers each integration's summary and details, its actions and whether each is enabled for this chat, its automation options and their values, and the recent runs. `detailsId` reads up to 100 items of one list, such as each check. The agent calls it first, for the ids. |
| `run_artifact_action` | Runs one `code` action. For a pull request: `markReady` and `merge` on the whole pull request, `rerunCheck` on one failed check, and `resolveThread` on one review thread. A `prompt` action, such as `fixCI`, `addressReviews` or `resolveConflicts`, is refused: the agent does that work in its own chat. An action whose outcome is not known is not run again. |
| `set_artifact_automation` | Sets the options an integration declares, each by its id and a value. The automation stays for that artifact in that session, acts after the turn without asking again, and posts a notice in the chat. |
| `disable_artifact_automation` | Turns automation off. With no `optionIds` it turns off every option that is on, and with no `integrationId` every integration of the artifact. Runs in progress finish. It posts a notice, and it is always available, so an automated turn can stop automation but never widen it. |

The pull request integration's automation options:

| Option | Kind | Values | Attempts |
| --- | --- | --- | --- |
| `fixCI` | on or off | Fix CI automatically | 3 |
| `addressReviews` | on or off | Address reviews automatically | 3 |
| `resolveConflicts` | on or off | Update the branch automatically | 3 |
| `markReady` | on or off | Mark ready automatically | 1 |
| `merge` | choice | `never`, `always`, or `ifUnchanged`, which merges only when no repair changed anything | 1 |

### Two ways a pull request shows

| Way | Where it comes from | What a person sees |
| --- | --- | --- |
| The session's pull request | VS Code finds the pull request of the session's branch, `findPullRequestByHeadBranch` | The pull request pill, with its state and actions |
| A recorded pull request | An agent records it with `add_artifact_or_reference` | A row in the Artifacts or References pill |

With the GitHub integration served, a recorded pull request decorates the pull request pill in place. It does not show a second time. ahpd serves no integration, so a recorded pull request stays a row.

### What else an integration can follow

The framework knows nothing of any one thing. It suits anything that a session makes or must follow, that lives outside the chat, and whose state changes by itself.

VS Code's own examples, in the proposal's section 9:

- An experiment. Its state is not started, running or completed, and its scorecard version. Start and stop are `code` actions, and analyze is a `prompt` action. Its automation is `analysis: off / everyMonday`, on a schedule the integration keeps.
- A deployment. A second integration attaches to the same pull request URL, and adds its own state and actions without changing the GitHub integration's.

Other things of the same shape, which VS Code does not name:

- a CI run;
- an issue;
- a release;
- a preview deployment;
- a computer that ahpd started for the session.

### What ahpd serves

- Recording entries works while `artifactTools` is on. Tested on 2026-11-23: a `pullRequest`, an `issue`, a `commit`, a `website`, a `file` and a `resource` each showed as a row.
- A `resource` row is a label. A click on `todo://t-buy-milk` answered "Unable to resolve resource todo://t-buy-milk".
- ahpd serves no integration, none of the four tools, and none of the five `vscode/*artifactIntegrations*` methods. The brief [artifact-integrations.md](../briefs/artifact-integrations.md) holds the answers so far. Agent Merge does not run while integrations are on, and the GitHub integration is new code built to VS Code's model.
