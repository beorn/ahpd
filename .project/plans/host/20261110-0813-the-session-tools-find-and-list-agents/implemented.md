---
title: The session tools find a session and list the agents - implemented
date: 2026-11-10
refs:
  - git://09152971b
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - the session tools"
---

A caller of the session tools finds a session and learns the agents without ahpc. PR #277 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `list_sessions` says each row's `agent` and takes `agent`, `limit`, `title`, `path`, `modifiedAfter` and `modifiedBefore`. `list_agents` and `list_models` answer the agents and their models. `create_session`'s `agent` is an enum of the caller's agents.
- [`code://docs/server/MCP.md`](../../../../docs/server/MCP.md) - `/mcp` serves nine tools to a member and four to a viewer.

## Verified

- `sessiontools.test.ts`, `host-tools.test.ts` and `mcp.test.ts`. CI passed on #277.

## Departures from the plan

- VS Code has no tools to list agents or models, so their text is ahpd's own in VS Code's style.

## Left for later

- None.
