---
title: An agent in a machine has its own memory
created: 2026-11-19
refs:
  - "[code://packages/agent-claude/src/claude.ts#L542-L555](../../packages/agent-claude/src/claude.ts#L542-L555) - the Claude state volume, seeded with this host's `~/.claude/CLAUDE.md`, skills, agents and commands"
  - "[code://packages/agent-claude/src/claude.ts#L117-L127](../../packages/agent-claude/src/claude.ts#L117-L127) - `computerConfigDir`, where the CLI in a machine reads its configuration"
---

An agent in a machine reads the memory of the person who runs the host. On 2026-11-19 a Claude session in a machine loaded `/ahpd/claude/CLAUDE.md`, seeded from the host's `~/.claude/CLAUDE.md`. It named Softov, the host's infrastructure and Softov's writing rules, and it kept its memory at `/ahpd/claude/projects/-/memory/`.
A machine is where an agent runs isolated, so its instructions and its memory are isolated too. Each agent in the machine has a memory of its own. The host's personal memory reaches it only when a person says so.
Source: Softov, 2026-11-19: "memory isolation for agents inside computer".
