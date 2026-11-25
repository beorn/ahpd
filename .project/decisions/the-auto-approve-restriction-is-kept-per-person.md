---
title: The auto-approve restriction is kept per person
status: accepted
date: 2026-11-18
refs:
  - "[code://packages/sdk/src/access/personrules.ts#L15](../../packages/sdk/src/access/personrules.ts#L15) - `APPROVAL_KEYS`, which holds `autoApprovePolicyRestricted`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L158-L163](../../packages/sdk/src/vscoderootconfig.ts#L158-L163) - VS Code's key, `readOnly`"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2830-L2846 - VS Code refuses a change to a read-only key from a relayed client only
---

## Context

`autoApprovePolicyRestricted` is a root config key that VS Code's schema marks `readOnly`. A window pushes it from its own policy at each connect. VS Code's host has one person, so one value for the host is that person's.
On a host with users, one value lets any person's window restrict or free every session on the host.

## Decision

On a host with users, `autoApprovePolicyRestricted` is one of `APPROVAL_KEYS`. A person's push is kept in their own file, and a session reads its owner's value, then the host's.
`readOnly` stays on the key, as a hint that a settings page draws no control for it.

## Consequences

A person's restriction holds in their sessions, and another person's push does not lift it.
A person can lift their own restriction from a client that does not push the policy. In VS Code too, a policy reaches only the windows it governs.
A value pushed before 0.15.0 stays the host's, for sessions whose owner keeps none.

## Options

- One value for the host, VS Code's shape. It lost because one person's push changes every session.
- A key only the host's own connection may write. It lost because a window pushes it, and the window is the one that knows its policy.
