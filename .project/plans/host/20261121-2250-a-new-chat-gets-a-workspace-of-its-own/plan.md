---
title: A new chat gets a workspace of its own
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Chat workspace*"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1284](../../../../packages/sdk/src/host/lifecycle.ts#L1284) - `moveChatWorkspace`, which moves one chat to a folder or a new worktree; this plan reuses it"
  - "[code://packages/sdk/src/tools/session.ts#L877](../../../../packages/sdk/src/tools/session.ts#L877) - `isolate_session`, offered only where the agent keeps a folder per chat"
  - "[code://packages/sdk/src/types/agent.ts#L844](../../../../packages/sdk/src/types/agent.ts#L844) - `multipleDirectories`, an agent's folder per chat"
  - "[code://packages/sdk/src/host/lifecycle.ts#L340](../../../../packages/sdk/src/host/lifecycle.ts#L340) - `scratchFolder`, a session's scratch folder"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1494](../../../../packages/sdk/src/host/sessionmethods.ts#L1494) - `createChat`, which reads the new `_meta`"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts`, the value and its checks; `node/protocolServerHandler.ts#L3965-L3985`, the method; `node/agentService.ts#L7216-L7392`, `setChatWorkspace` and its refusals
---

## Goal

A client gives a peer chat its own folder, a new worktree of a folder, or a scratch folder. It does so when it creates the chat, or later while the chat has not started a turn. This is VS Code's `vscode.chatWorkspace` on `createChat`, and its `vscode/setChatWorkspace`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "createChatWorkspace|chatWorkspace|setChatWorkspace" packages/` - nothing.
- `rg "moveChatWorkspace|multipleDirectories" packages/sdk/src` - a chat already moves to a folder or a new worktree of its own, through `set_workspace` and `isolate_session`.

### Runtime path

```
createChat _meta['vscode.chatWorkspace'] -> the chat starts in that folder, worktree or scratch folder
vscode/setChatWorkspace {chat, workspace} -> checks -> moveChatWorkspace without a continuation turn -> chat/workingDirectorySet
```

### Gaps

- A client cannot choose a chat's folder; only the agent's own tools move one.
- A scratch folder is a session's, not a chat's.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan chat workspace | Softov, 2026-11-21, "Plan it, with a folder per chat" | 01, 02 |
| The folder per chat exists already, so no earlier plan is needed | `code://packages/sdk/src/host/lifecycle.ts#L1284` | - |
| The value is `{kind: 'scratch'}`, `{kind: 'folder', folder, isolation: 'folder'}`, or `{kind: 'folder', folder, isolation: 'worktree', baseBranch?, prompt}` | (defaulted: VS Code `chatWorkspaceValueValidator`) | 01 |
| A folder that is not an absolute `file:` URI, and a base branch that is blank or starts with `-`, are invalid | (defaulted: VS Code `readChatWorkspaceValue`) | 01 |
| Refused: the default chat, a chat of another session, a chat not made by a person, a chat that started, a chat already being given a workspace, an agent without a folder per chat, and a workspace with `workingDirectories`, a fork or a side chat | (defaulted: VS Code L7216-L7392) | 01, 02 |
| A folder inside a chat's scratch folder is refused, on `createChat` and on the method | (defaulted: VS Code `_requireNonScratchChatFolder`, L7181 and L7281) | 01, 02 |
| The calling connection is the move's `sender`, so the folder's trust is asked of it | `code://packages/sdk/src/host/lifecycle.ts#L48-L52` | 01, 02 |
| A new worktree's branch is named as `cutTree` names one; `prompt` is kept for the agent's first turn only | `code://packages/sdk/src/host/lifecycle.ts#L1614-L1638` | 01 |
| A chat already in that folder only, or already in a scratch folder of its own, is left as it is | (defaulted: VS Code L7283-L7290) | 02 |
| Both need `chat:folders`; `_meta` advertises `vscode.createChatWorkspace` | (defaulted: the gate's chat folder grant, VS Code's capability) | 01 |
| The folder a chat leaves is released, and its scratch folder removed, only after the chat works in the new one | (defaulted: VS Code L7313-L7318) | 02 |

## Proposed architecture

- **Data flow** - `createChat` and the method read the value with one shared reader, and call `moveChatWorkspace` with no continuation turn.
- **State flow** - the chats being given a workspace, to refuse a second request and a first message meanwhile.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/host/chatworkspace.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A chat is created in its own workspace](task-01-a-chat-is-created-in-its-workspace.md) | done | - |
| [02 - A chat that has not started is given a workspace](task-02-a-chat-is-given-a-workspace.md) | done | 01 |

## Risks and tradeoffs

- A worktree cut for a chat that is then closed stays on disk. It is a managed worktree, so the worktree cleanup queue sees it.

## Resume state

- **Done so far:** tasks 01 and 02 are written and committed, and [implemented.md](implemented.md) records them. `chat-workspace.test.ts` (21/21), the sdk suite (5218) and the computer suite (634) passed before the ownership check; the run after it is in progress.
- **Next action:** none. Merged as #431, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** `moveChatWorkspace` starts a continuation turn unless `Move.continuation` is `false`. `createChat` also needs `chat:folders` through `admission.ts`, which task 01's file list does not name. When a worktree `prompt` and an `initialMessage` are both sent, the current code keeps the `initialMessage` and drops the prompt. `vscode/setChatWorkspace` takes `{chat, workspace}` only, so "a chat of another session" is read as a chat no session of this host is running. `setChatWorkspace` ignores a worktree `prompt`. Task 02 also touched `context.ts`, `host.ts` and `chatactions.ts`, which its file list does not name. The review added `requireWorkspaceAuthority`, so both paths refuse another person's session, and its test is in `users-gate-sessions.test.ts` rather than `chat-workspace.test.ts`.

## Final verification checklist

- [ ] A test: `createChat` with each of the three kinds puts the chat in that folder.
- [ ] A test: `setChatWorkspace` moves a chat with no turn, and refuses one that started.
- [ ] A test: each refusal in the *Answers* table, in VS Code's words.
- [ ] The gates pass: typecheck, boundary, and the sdk suite.
