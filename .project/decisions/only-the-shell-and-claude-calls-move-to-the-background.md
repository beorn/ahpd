---
title: Only the shell and Claude's calls move to the background for now
status: accepted
date: 2026-11-21
refs:
  - git://eb832a04f - the merge of PR #407, which made the shell and Claude's calls movable
  - "[code://packages/sdk/src/tools/shell.ts](../../packages/sdk/src/tools/shell.ts) - the host shell's sync command, the one call the host can move"
  - "[code://packages/sdk/src/host/tooling.ts](../../packages/sdk/src/host/tooling.ts) - `shellToolsFor`, which turns the host shell off on Windows"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../packages/sdk/src/host/vscodemethods.ts) - `x-ahpd/backgroundToolCall`, the method any client with `chat:send` can call"
  - "[code://packages/sdk/src/host/gate.ts](../../packages/sdk/src/host/gate.ts) - the gate that grants `x-ahpd/backgroundToolCall` to `chat:send`"
---

## Context

A running tool call can move to the background, through `x-ahpd/backgroundToolCall`, once its provider offers it.
The host shell moves its sync command, and Claude moves its foreground Bash and subagent calls through the SDK.
Two questions were left open: whether pi's other tools should be movable, and whether an agent in another session should be able to move a call.

## Decision

pi's other tools stay out of scope.
The `bash` tool is the only one that runs long enough to move, and the host shell already covers it on Linux and macOS.
The `read`, `edit`, `write`, `grep`, `find` and `ls` tools finish in moments, and pi has no subagent tool.

The Windows PowerShell tool in pi stays out of scope too.
The host shell is off on Windows, so a PowerShell call cannot move until that changes.

An agent in another session does not get a tool that moves a call.
A client with `chat:send` can already call `x-ahpd/backgroundToolCall`, and the method is the one place the move is checked.
A tool for agents would let one session move another session's call, so it needs its own permission check, and no one has asked for it yet.

## Consequences

- Nothing in ahpd or the clients changes for these cases.
- Reopen the pi tools when a pi user needs a long PowerShell command to move on Windows.
- Reopen the cross-session tool when an agent needs to move another session's call, and decide its permission then.
