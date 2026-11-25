---
title: A chat runs on an agent of its own
domain: host
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers chats with their own agent
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `InitializeResult.multipleChatProviders`, `CreateChatParams.provider`, `provider` on `ChatState`, `ChatSummary` and `SessionChatSummary`, and `ChatConfigState.schema`
  - git://github.com/microsoft/vscode@7e993177c9d9 - `common/agentHostChatProviders.ts`: the root key `multipleChatProviders.enabled`, default off; `node/protocolServerHandler.ts` advertises the capability only while it is on and from protocol 1.1.0; `node/agentService.ts` `createChat` starts the chat on the asked agent with that agent's own config
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1601-L1608](../../../../packages/sdk/src/host/sessionmethods.ts#L1601-L1608) - `createChat` refuses `provider`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1833-L1840](../../../../packages/sdk/src/host/sessionmethods.ts#L1833-L1840) - a fork of a chat on another backend already takes that chat's agent and config"
  - "[code://packages/sdk/src/host/spawn.ts#L2062](../../../../packages/sdk/src/host/spawn.ts#L2062) - `foreign`: a chat whose agent is not its session's"
  - "[code://packages/sdk/src/host/spawn.ts#L2127](../../../../packages/sdk/src/host/spawn.ts#L2127) - `held.backends`, where a chat on another backend is kept"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1563](../../../../packages/sdk/src/host/lifecycle.ts#L1563) - `getProviderForChat`"
  - "[code://packages/sdk/src/host/catalogue.ts#L260](../../../../packages/sdk/src/host/catalogue.ts#L260) - a chat summary already says `provider` for a chat on another backend"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L36-L60](../../../../packages/sdk/src/vscoderootconfig.ts#L36-L60) - the VS Code root keys this host reads, `chatMoves.enabled` among them"
  - "[code://packages/sdk/src/host/handshake.ts#L441-L446](../../../../packages/sdk/src/host/handshake.ts#L441-L446) - the `initialize` result"
---

## Goal

One session holds chats on different agents. A person adds a pi chat to a Claude session. Each chat runs on its own agent, with its own settings. ahpd turns this on by default, under VS Code's setting.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "backends\.set" packages/sdk/src` on 2026-11-24 - spawn keeps a chat on another backend by its URI, today for plugin chats.
- `rg -n "provider" packages/sdk/src/host/catalogue.ts` - a chat summary says `provider` for such a chat.
- `rg -n "multipleChatProviders" packages/sdk/src` - only the refusal in `createChat` names it.

### Gaps

- `initialize` does not say `multipleChatProviders`.
- `createChat` refuses `provider`.
- A chat on another agent has no `config.schema` of its own.
- No root setting turns the feature on or off.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass, six plans by feature | Softov, 2026-11-24 | - |
| VS Code's root key `multipleChatProviders.enabled`, default on in ahpd | Softov, 2026-11-24, chose "VS Code's setting, on by default" | 01 |
| The capability is said only while the setting is on, and only to a client on 1.1.0 or later | `(defaulted: VS Code's gate)` | 01 |
| A `provider` that is unknown, off or paused is refused in VS Code's words | `(defaulted: VS Code's refusal)` | 02 |
| A chat on another agent starts with that agent's own config and schema, not the session's | `(defaulted: 1.1.0 and VS Code)` | 03 |
| A fork or side chat keeps its source chat's agent | `(defaulted: 1.1.0 says so)` | 02 |

## Proposed architecture

- **Data flow** - `createChat` with `provider` finds that agent, and spawn starts the chat on it, kept in `held.backends`.
- **Event flow** - `session/chatAdded` and the chat's state carry `provider`; `chat/configChanged` carries the chat's own schema.
- **State flow** - the chat's agent is recorded with the chat, so a restart starts it on the same agent.
- **Layer responsibilities** - sdk host: the setting, the handshake, `createChat`, the chat's config.
- **Source-of-truth files** - [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the host says it serves chats of other agents](task-01-the-host-says-it-serves-them.md) | done | - |
| [02 - a chat is made on the agent it asks for](task-02-a-chat-is-made-on-its-agent.md) | done | 01 |
| [03 - the chat has its agent's own config](task-03-the-chat-has-its-agents-config.md) | done | 02 |
| [04 - the documents say it](task-04-the-documents-say-it.md) | done | 03 |

## Risks and tradeoffs

- A chat on another agent runs a second backend in the session - it is started and stopped as a plugin chat's backend is.
- A chat on another agent on a machine - it runs on the session's machine, as a plugin chat does.

## Resume state

- **Done so far:** tasks 01 to 04, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** a chat whose `provider` is the session's own agent is an ordinary chat; record no `provider` for it.

## Final verification checklist

- [ ] `initialize` says `multipleChatProviders` with the setting on, and not with it off.
- [ ] A chat made with another `provider` runs on that agent and says `provider`.
- [ ] Its `config.schema` is its agent's, and a restart keeps both.
- [ ] The sdk and server suites pass, and then the whole repo.
