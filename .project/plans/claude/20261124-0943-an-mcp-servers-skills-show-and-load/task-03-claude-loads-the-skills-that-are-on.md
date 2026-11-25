---
title: Claude loads the skills that are on
status: done
depends: [02]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L522](../../../../packages/agent-claude/src/session/query.ts#L522) - the local plugins the CLI loads"
---

## Objective

The files of each skill that is on are in a local plugin folder of the session, and the CLI loads it. A skill turned off leaves the folder.

## Files

- `UPDATE: packages/agent-claude/src/session/mcpskills.ts` - read a skill's files with `read(uri)` and write them under the session's plugin folder.
- `UPDATE: packages/agent-claude/src/session/query.ts:522` - add the folder to the CLI's local plugins.
- `UPDATE: packages/agent-claude/test/agent-claude-mcp-skills.test.ts` - the load cases.

## Steps

1. Read `SKILL.md` and each file the skill names with `read(uri)`.
2. Write them as `skills/<name>/` under one plugin folder per session, refusing a path that leaves it.
3. Add the folder to the CLI's local plugins with `skipMcpDiscovery: true`.
4. Remove a skill's files when a person turns it off, and reload the CLI's plugins.
5. Add cases: a skill that is on is in the folder, and one turned off is not.

## Validation

- `agent-claude-mcp-skills.test.ts`: the load cases.
- Run the agent-claude suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The `SKILL.md` in the folder is the host's own, and the server's is `files/INSTRUCTIONS.md`. The CLI runs the `!` lines and the `hooks` of a `SKILL.md`, so the server's own would run commands. Each file is checked against its digest and size.
