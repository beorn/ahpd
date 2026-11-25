---
title: An agent isolates its chat in a new worktree - implemented
date: 2026-11-10
refs:
  - git://9dc797e02
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - `isolate_session`"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - who the tool is offered to"
---

An agent moves its own chat into a new git worktree with `isolate_session`. It is VS Code's tool, by its name, description and refusals. PR #286 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `isolate_session` takes no input. At the turn's end, the calling chat moves to a new worktree cut from its one local git folder. The session's folders gain it, and a turn continues the task. Other chats keep their folders.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the tool is offered only to an agent that keeps a folder per chat, only to the session's own chats, deferred, and with `session:write`.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - the types the tool reads.
- The tool refuses outside a turn, with arguments, without exactly one local folder, and where no worktree can be cut. It runs through the `set_workspace` move, so the window is asked about the folder and the worktree.
- [`code://docs/sdk/TOOLS.md`](../../../../docs/sdk/TOOLS.md), [`code://docs/sdk/BUILD-A-HOST.md`](../../../../docs/sdk/BUILD-A-HOST.md) and [`code://docs/server/MCP.md`](../../../../docs/server/MCP.md) - the tool.

## Verified

- [`code://packages/sdk/test/host-tools.test.ts`](../../../../packages/sdk/test/host-tools.test.ts) and [`code://packages/sdk/test/sessiontools.test.ts`](../../../../packages/sdk/test/sessiontools.test.ts) - the offer, the move and each refusal. CI passed on #286.

## Departures from the plan

- VS Code's confirmation words, "Change Workspace?", have no field in the protocol's `ToolDefinition`. The person confirms through the backend's own prompt, as for `set_workspace`.

## Left for later

- None.
