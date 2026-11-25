---
title: An MCP server's skills show and load
domain: claude
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers `McpServerCustomization.children`
  - git://github.com/softov/cofold@f08ce52 - cofold plan `agent/20261124-0950-the-mcp-client-reads-a-servers-skills`, which gives `@cofold/mcp-client` `skills()`, `skill(uri)` and `read(uri)`
  - https://modelcontextprotocol.io/seps/2640-skills-extension - SEP-2640, skills served by an MCP server
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `McpServerCustomization.children` in `types/channels-session/state.ts`
  - git://github.com/microsoft/vscode@7e993177c9d9 - `node/shared/mcpCustomizationController.ts`: a skill's id is `<server>#skill=<encoded uri>`, and its name is the declared name or the skill's folder
  - "[code://packages/agent-claude/src/session/customizations.ts#L504-L515](../../../../packages/agent-claude/src/session/customizations.ts#L504-L515) - the `mcpServer` customization, with no `children`"
  - "[code://packages/agent-claude/src/session/servers.ts#L24-L25](../../../../packages/agent-claude/src/session/servers.ts#L24-L25) - `ctx.mcpServers`, the configs the CLI is told about"
  - "[code://packages/agent-claude/src/session/query.ts#L522](../../../../packages/agent-claude/src/session/query.ts#L522) - the local plugins the CLI loads skills from"
  - "[code://packages/sdk/src/host/chatactions.ts#L1990-L2010](../../../../packages/sdk/src/host/chatactions.ts#L1990-L2010) - `session/customizationToggled`, by id"
---

## Goal

A Claude session shows the skills each of its MCP servers serves, under that server, and a person turns each one on or off. The Claude CLI can use the skills that are on, as it uses its own.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -l "'mcpServer'" packages/*/src` on 2026-11-24 - only agent-claude reports MCP servers as customizations.
- `sdk.d.ts` of the Claude SDK 0.3.325 - the SDK reports no skill an MCP server serves.
- `rg -l "resources/list|mcp://" packages/*/src` - ahpd has no MCP connection of its own to a session's servers.
- `git grep "IMcpSkill"` in VS Code main - only the Copilot agent fills `children`, from its SDK.

### Gaps

- No `mcpServer` customization has `children`.
- Nothing lists a server's skills, or gives one to the CLI.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass, six plans by feature | Softov, 2026-11-24 | - |
| The host discovers the skills itself | Softov, 2026-11-24, chose "The host discovers them" | 01 |
| The client is `@cofold/mcp-client`, extended by the cofold plan | Softov, 2026-11-24, chose "Extend @cofold/mcp-client" | 01 |
| A skill's id is VS Code's `<server id>#skill=<encoded uri>` | `(defaulted: VS Code's id)` | 01 |
| Discovery lives in agent-claude, the one agent that reports MCP servers | `(defaulted: the code goes where the configs are)` | 01 |
| A server that needs a sign-in ahpd does not hold has no `children` | `(defaulted: 1.1.0 says absent means not discovered)` | 01 |
| An enabled skill's files are written into a local plugin folder the CLI loads | `(defaulted: the CLI loads skills from a local plugin)` | 03 |

## Proposed architecture

- **Data flow** - for each MCP server in `ctx.mcpServers`, agent-claude connects with `@cofold/mcp-client`, lists its skills, and lays them as `children`.
- **Event flow** - a toggle by a skill's id changes its `enabled`, and the session's customizations are said again.
- **State flow** - the enabled skills' files are written under the session's plugin folder, and the CLI's plugins are reloaded.
- **Layer responsibilities** - agent-claude: discovery, the toggle, the plugin folder · cofold: the MCP calls.
- **Source-of-truth files** - `packages/agent-claude/src/session/mcpskills.ts`, which task 01 creates.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a server lists its skills](task-01-a-server-lists-its-skills.md) | done | - |
| [02 - a toggle switches a skill](task-02-a-toggle-switches-a-skill.md) | done | 01 |
| [03 - claude loads the skills that are on](task-03-claude-loads-the-skills-that-are-on.md) | done | 02 |
| [04 - the documents say it](task-04-the-documents-say-it.md) | done | 03 |

## Risks and tradeoffs

- A second connection to each server, beside the CLI's - the connection closes once the skills are listed, and opens again on a refresh.
- A skill's files come from a server - ahpd writes them only inside the session's plugin folder, and refuses a path that leaves it.
- The cofold release with the skill calls is a tag only Softov pushes - this plan waits for it.

## Resume state

- **Done so far:** tasks 01 to 04, on 2026-11-24, on a branch that is not merged.
- **Next action:** Softov approves `@cofold/mcp-client` 0.2.0 on npm. Then the lockfile, the whole suite and the PR.
- **Open questions:** none.
- **Watch out for:** an empty `children` means the server was asked and serves none; leave it out when it was not asked.

## Final verification checklist

- [ ] A fake MCP server with two skills shows them as `children`.
- [ ] A toggle by a skill's id turns it off and on.
- [ ] The CLI's plugin folder holds the skills that are on.
- [ ] The agent-claude suite passes, and then the whole repo.
