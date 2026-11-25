---
title: ahpd adopts the cofold releases - implemented
date: 2026-11-21
refs:
  - "[code://packages/agent-cofold/package.json](../../../../packages/agent-cofold/package.json) - `@cofold/tools` at `^0.4.2`"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts) - the cut turn's reason, read back"
  - "[code://packages/agent-acp/src/presets.ts](../../../../packages/agent-acp/src/presets.ts) - the copapo preset comment"
  - npm://@cofold/tools@0.4.2 - the memory index reminder
  - npm://@cofold/copapo@0.2.0 - MCP over stdio and http
---

Three changes, and five items that the code already matched.

- `@cofold/tools` is `^0.4.2`. Its one change is a reminder in `memory_write` when the index does not name the file written.
- A test checks that a cut turn reads back with the reason ahpd cancelled it with.
- The copapo preset comment says copapo 0.2.0 takes stdio and http MCP servers.

Where it departs from the plan:

- Task 04 keeps the tool table. `subject` was already in 0.4.1 and is a display string, so it cannot carry a permission kind or an absolute path.
- Tasks 03, 05 and 08 needed no change. The pause helpers went in plugin/40. A `command` message is meant to read as typed. `requireRead` is passed through today.
- Task 06 needed no code: the reason is in cofold's marker, which the transcript shows.

Verified on 2026-11-21 in the worktree:

- `pnpm typecheck` exits 0.
- `pnpm exec vitest run packages/agent-cofold` passes: 18 files, 327 tests, with the schema generated first.
