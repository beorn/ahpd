---
title: Backend keys are chat-mutable
status: dropped
depends: [02]
layer: "agents"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L625-L648](../../../../packages/sdk/src/types/agent.ts#L625-L648) - `schema()`, which documents `scope`"
  - "[code://packages/agent-claude/src/claude.ts#L222-L347](../../../../packages/agent-claude/src/claude.ts#L222-L347) - `permissionMode`, `effortLevel` and `permissions`"
  - "[code://packages/agent-cofold/src/agent.ts#L421-L482](../../../../packages/agent-cofold/src/agent.ts#L421-L482) - `effortLevel`, a `scope: 'chat'` key that becomes chat-mutable through `published`, with no edit here"
  - "[code://packages/agent-acp/src/session/config.ts#L165-L180](../../../../packages/agent-acp/src/session/config.ts#L165-L180) - the `acp.<id>` option keys"
  - "[code://packages/agent-pi/src/types.ts#L68](../../../../packages/agent-pi/src/types.ts#L68) - `permissionModeProperty`"
  - "git://github.com/microsoft/vscode@e941aa12741 - `agentHostSchema.ts` and `claudeAgent.ts`, the keys VS Code marks chat-mutable"
---

Built on main by `7f7a74ffe`: agent-acp marks its keys `chatMutable`. Task 07 moves it to the package types.

## Objective

Every `scope: 'chat'` key goes out as `chatMutable: true`, and Claude's `permissionMode` and `permissions` carry `chatMutable: true` as shared keys.
A 1.143 window then offers these keys per chat.

## Files

- `UPDATE: packages/sdk/test/chat-config.test.ts` - the published schema cases.
- `UPDATE: packages/sdk/src/types/agent.ts:625-648` - the `schema()` comment names `chatMutable`, and drops "a permission mode is the session's".
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:261-315` - `published` writes `chatMutable: true` for a `scope: 'chat'` key, and keeps a `chatMutable` that a backend sets.
- `UPDATE: packages/agent-claude/src/claude.ts:222-347` - `permissionMode` and `permissions` get `chatMutable: true` and keep `scope: 'session'`.

## Steps

1. In `published`, write `chatMutable: true` for each `scope: 'chat'` key, then drop `scope` as today.
2. Keep a `chatMutable` that a backend sets on a shared key.
3. Add `chatMutable: true` to Claude's `permissionMode` and `permissions`.
4. Rewrite the `schema()` comment: `scope: 'chat'` is a per-chat key, and `chatMutable` on a shared key lets a chat change it.
5. Remove the sentence "a permission mode is the session's" from that comment.

## Validation

- `packages/sdk/test/chat-config.test.ts` - the published schema carries `chatMutable` on `effortLevel`, `permissionMode` and `permissions`, and on no other Claude key.
- The same file - a chat write to `permissionMode` changes that chat only.
- `pnpm vitest run` passes in sdk, agent-claude and agent-acp.
- A VS Code 1.143 window shows a per-chat control for `permissionMode`, checked by hand.

## Resume

