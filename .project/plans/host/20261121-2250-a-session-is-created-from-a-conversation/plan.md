---
title: A session is created from a conversation
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Session import*, the chunks"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1258](../../../../packages/sdk/src/host/sessionmethods.ts#L1258) - `createSession`, which reads the import"
  - "[code://packages/agent-claude/src/transcript.ts#L58](../../../../packages/agent-claude/src/transcript.ts#L58) - `turnsOf`, which reads Claude's frames; the writer mirrors it"
  - "[code://packages/agent-pi/src/transcript.ts](../../../../packages/agent-pi/src/transcript.ts) - pi's history reader"
  - "[code://packages/agent-cofold/src/transcript.ts](../../../../packages/agent-cofold/src/transcript.ts) - cofold's history reader"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/meta/vscode/agentHostCreateSessionImportMeta.ts`, the limits, the value and its reader; `node/protocolServerHandler.ts#L4095-L4150`, staging and taking chunks; `node/agentService.ts#L6607-L6611`, fresh turn ids; `common/agent.ts#L959-L963`, the value; `AGENTS.md#L283`, the title
---

## Goal

A client creates a session from a conversation it already has, such as a chat from another host, sent in chunks when it is large. The agent writes the turns as its own history, so the new session resumes, forks and truncates like one it ran itself. An agent that cannot write its history does not offer this.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "importConversation|createSessionImport|stageCreateSessionImportChunk" packages/` - nothing.
- `rg "writeFile|appendFile" packages/agent-claude/src/transcript.ts` - nothing: agent-claude reads Claude's frames and never writes them.

### Runtime path

```
vscode/stageCreateSessionImportChunk {transferId, chunk} x N -> held per connection
createSession _meta['vscode.importConversation'] {transferId} or {turns, model?, title?}
  -> fresh turn ids -> the agent writes its history -> the session resumes from it
```

### Gaps

- No agent writes a history it did not run.
- `createSession` takes no turns.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan the chunked import too | Softov, 2026-11-21, "Read the handler, then plan it (Recommended)", for the group with its chunks | 01 |
| Claude writes a real transcript | Softov, 2026-11-21, "Claude writes a real transcript" | 02 |
| The writer is made from the CLI's own session files, since VS Code's Claude agent seeds no transcript | VS Code `node/claude/claudeAgent.ts#L1552` | 02 |
| Cofold and pi write theirs if their formats allow | Softov, 2026-11-21, "Cofold and pi if possible also" | 03 |
| ACP does not offer it | Softov, 2026-11-21, "Duno how ACP will do", and ACP has no way to load a history it did not make | - |
| An agent that cannot write a history does not advertise the capability | Softov, 2026-11-21, "Agents that cannot write a history, do not advertise the capability." | 01 |
| `_meta` carries `vscode.createSessionImport` while one agent can import; `createSession` for an agent that cannot is refused | (defaulted: the flag is the host's, the ability each agent's) | 01 |
| A chunk is at most 1,048,576 UTF-16 units, and a connection holds at most 268,435,456 staged; a chunk past that drops its transfer and is refused | (defaulted: VS Code's two limits) | 01 |
| Staged chunks go when the connection closes; `createSession` takes and drops its transfer | (defaulted: VS Code L4105-L4150) | 01 |
| The value is validated as VS Code's reader does; a model with a blank id is invalid | (defaulted: VS Code `readCreateSessionImportValue`) | 01 |
| Each imported turn gets a fresh id | (defaulted: VS Code L6608) | 01 |
| A nonblank `title` is the session's title and stops a title being made | (defaulted: VS Code `AGENTS.md#L283`) | 01 |
| An import cannot be combined with a fork | (defaulted: VS Code `importConversation` docs) | 01 |
| A session with an import does not wait to cut its worktree on the first turn | (defaulted: VS Code L6623) | 01 |
| `vscode/stageCreateSessionImportChunk` needs `session:create`, and is not served through a relay | (defaulted: `createSession`'s grant, VS Code L4308-L4310) | 01 |

## Proposed architecture

- **Data flow** - the host stages chunks, `createSession` joins and validates them, and the agent's `importConversation` writes the history before the session starts.
- **State flow** - the staged transfers by connection, with their total size.
- **Layer responsibilities** - sdk: staging, the value and the capability; agent-claude, agent-pi, agent-cofold: the writers.
- **Source-of-truth files** - `packages/sdk/src/host/sessionimport.ts`, created here, and each agent's `transcript.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A conversation is staged and taken by createSession](task-01-staged-and-taken.md) | done | - |
| [02 - Claude writes an imported conversation](task-02-claude-writes-an-import.md) | done | 01 |
| [03 - Pi and cofold write an imported conversation](task-03-pi-and-cofold-write-an-import.md) | done | 01 |

## Risks and tradeoffs

- Claude's frames are the CLI's format, which a CLI release can change. The writer is tested by resuming the written session with the CLI ahpd pins.
- A turn's tool calls may have no frame that both formats share. Such a part is written as text, and `implemented.md` lists what was lost.

## Resume state

- **Done so far:** task 01: the method, the staged state, the reader, `Agent.importConversation`, the capability and `createSession`'s import. Task 02: the Claude writer, the read-back, and the resume. Task 03: the pi and cofold writers, each read back through its own reader, and the resume from the written session. `implemented.md` is written, and `pnpm typecheck` and `pnpm boundary` pass.
- **Next action:** none. Merged as #434, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** a chunk is cut at a UTF-16 surrogate pair boundary by VS Code; join chunks as strings, never as bytes.

## Final verification checklist

- [ ] A test: three chunks staged and taken by `createSession` give the conversation's turns.
- [ ] A test: the two limits, a closed connection, and an unknown transfer.
- [ ] A test: a Claude session made from an import resumes, and a turn sent to it sees the earlier turns.
- [ ] A test: pi and cofold, or `deferred.md` saying why one cannot.
- [ ] The gates pass: typecheck, boundary, and the sdk, claude, pi and cofold suites, one at a time.
