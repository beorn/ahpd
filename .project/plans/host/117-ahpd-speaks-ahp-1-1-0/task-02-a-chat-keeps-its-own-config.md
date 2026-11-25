---
title: A chat keeps its own config
status: dropped
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L680-L1058](../../../../packages/sdk/src/host/chatactions.ts#L680-L1058) - the `session/configChanged` case, whose refusals and `undo` this task reuses"
  - "[code://packages/sdk/src/host/chatactions.ts#L1004-L1020](../../../../packages/sdk/src/host/chatactions.ts#L1004-L1020) - `everywhere`, the loop that sends a shared key to the other chats"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L261-L315](../../../../packages/sdk/src/host/sessionconfig.ts#L261-L315) - `propertyOf` and `published`"
  - "[code://packages/sdk/src/host/snapshots.ts#L310-L335](../../../../packages/sdk/src/host/snapshots.ts#L310-L335) - the chat snapshot"
  - "[code://packages/sdk/src/sessions/sessions.ts#L166-L173](../../../../packages/sdk/src/sessions/sessions.ts#L166-L173) - `chatFlags` and `setChatFlags`, the pattern for a per-chat value in the store"
  - "[code://packages/sdk/src/host/gate.ts#L158](../../../../packages/sdk/src/host/gate.ts#L158) - the grant for `session/configChanged`"
  - "git://github.com/microsoft/agent-host-protocol@dbbd1217 - the reducer and its four fixtures"
  - "git://github.com/microsoft/vscode@e941aa12741 - `_prepareChatConfigAction` and `validateChatConfigWrite` in `agentService.ts`"
---

Built on main by `7f7a74ffe` and `20e812035`, on types vendored from VS Code. Task 07 moves it to the package types.

## Objective

A client sets a config key for one chat with `chat/configChanged`, and the chat snapshot shows the overlay as `config`.
The overlay survives a restart, and a refused write leaves the chat as it was.

## Files

- `CREATE: packages/sdk/test/chat-config.test.ts` - the per-chat config cases.
- `UPDATE: packages/sdk/src/host/chatactions.ts:680-1058` - a `chat/configChanged` case beside the session case.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts:261-315` - `propertyOf` reads `chatMutable`, and `published` keeps it on the wire.
- `UPDATE: packages/sdk/src/host/snapshots.ts:310-335` - the chat state gets `config: { values }` from the store.
- `UPDATE: packages/sdk/src/sessions/sessions.ts:166-173` - `chatConfig` and `setChatConfig` beside `chatFlags`.
- `UPDATE: packages/sdk/src/types/sessions.ts:462-464` - the two store methods.
- `UPDATE: packages/sdk/src/host/gate.ts:158` - `chat/configChanged` needs `session:configure`.
- `UPDATE: packages/sdk/test/conformance.test.ts` - replay `chat/configChanged` through the 1.1.0 reducer.

## Steps

1. Add the `chat/configChanged` case, and resolve the chat from the channel as the session case does.
2. Refuse a subagent or worker chat with "inherits its config from the chat that spawned it".
3. Refuse a key without `chatMutable: true`, with the reason that the Answers table gives.
4. Apply the refusals of the session case: a host key, a fixed key, and a backend with no `setConfig`.
5. Send each accepted key to the chat's own session with `setConfig`, and to no other chat.
6. For a `replace`, send the session's value for each key that leaves the overlay.
7. On `true`, write the overlay to the store and dispatch `chat/configChanged` on the chat channel.
8. On a refusal, call `undo` for the key and `no` with the backend's words.
9. Change `everywhere` in the session case to skip a chat whose overlay holds the key.
10. Lay the stored overlay over the chat state in `snapshots.ts`, and leave it out when it is empty.

## Validation

- `packages/sdk/test/chat-config.test.ts` - merge, replace, a first write with no overlay, and a replace that resets one key.
- The same file - each refusal leaves the overlay as it was.
- The same file - the refusals are a key that is not chat-mutable, a subagent chat and a backend refusal.
- The same file - a session write skips a chat that overrides the key, and reaches one that does not.
- The same file - the overlay is in the snapshot after the host restarts.
- `pnpm typecheck`, `pnpm boundary`, `pnpm schema` and the sdk vitest suite pass.

## Resume

