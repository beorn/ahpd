---
title: A server lists its skills
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/customizations.ts#L504-L515](../../../../packages/agent-claude/src/session/customizations.ts#L504-L515) - the `mcpServer` customization"
  - "[code://packages/agent-claude/src/session/servers.ts#L24-L25](../../../../packages/agent-claude/src/session/servers.ts#L24-L25) - `ctx.mcpServers`"
---

## Objective

Each `mcpServer` customization of a Claude session has `children`, the skills its server serves, when ahpd could ask it.

## Files

- `UPDATE: packages/agent-claude/package.json` - depend on the `@cofold/mcp-client` release with the skill calls.
- `CREATE: packages/agent-claude/src/session/mcpskills.ts` - connect to one server, list its skills, and map them to `SkillCustomization` entries.
- `UPDATE: packages/agent-claude/src/session/customizations.ts:504-515` - lay `children` on the server's entry.
- `CREATE: packages/agent-claude/test/agent-claude-mcp-skills.test.ts` - the cases, with a fake MCP server.

## Steps

1. Add the `@cofold/mcp-client` dependency at the version that has `skills()`.
2. In `mcpskills.ts`, connect with the server's config from `ctx.mcpServers`, read `servesSkills`, list the skills, and close.
3. Map each skill to `{ type: 'skill', id: '<server id>#skill=<encoded uri>', name, description, enabled }`.
4. Name a skill by its declared name, else by its folder in the URI.
5. Lay the list as `children` of the server's entry, and leave `children` out when the server was not asked.
6. Ask each server again when the session's servers change.
7. Add cases: a server with two skills, a server without the extension, and a server that refuses to connect.

## Validation

- `agent-claude-mcp-skills.test.ts`: the cases.
- Run the agent-claude suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The host asks only the servers that the CLI reports connected, so it starts nothing a person did not let start. A stdio server gets the environment the CLI has. `@cofold/mcp-client` 0.2.0 was linked from the local cofold, and the lockfile waits for its release.
