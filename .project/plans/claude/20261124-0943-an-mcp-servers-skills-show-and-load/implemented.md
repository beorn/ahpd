---
title: An MCP server's skills show and load - implemented
date: 2026-11-24
refs:
  - "[code://packages/agent-claude/src/session/mcpskills.ts](../../../../packages/agent-claude/src/session/mcpskills.ts) - asking, listing and the folder"
  - "[code://packages/agent-claude/src/session/servers.ts](../../../../packages/agent-claude/src/session/servers.ts) - where the servers and the switch meet it"
---

A Claude session lists the skills each of its MCP servers serves, under the server. A person turns each one on or off, and the CLI loads the ones that are on.

## Verified

- `agent-claude-mcp-skills.test.ts`: ten cases. `agent-claude-mcp-skills-session.test.ts`: three cases.
- The agent-claude suite: 726 cases.
- The whole suite on cofold from npm: 616 files, 10559 cases.
- The Claude CLI of SDK 0.3.325, with no turn. A skill added to the folder is listed after a reload, and one removed is not.

## Departures from the plan

- The `SKILL.md` in the folder is the host's own. The CLI runs the commands and hooks that a `SKILL.md` names as it loads it.
- Only a server that the CLI reports connected is asked.
- A stdio server gets the environment the CLI has, and nothing more of the daemon's.
- The choice goes with the daemon's process, where the plan kept it past a restart. VS Code's host keeps it the same way.
- A server in a plugin, and one of a session in a machine, is not asked.
- The host reads a skill's files as it lists it. SEP-2640 asks a host not to read ahead of need, and the CLI loads only files that are there.
