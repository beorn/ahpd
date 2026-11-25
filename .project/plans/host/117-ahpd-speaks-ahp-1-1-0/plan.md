---
title: ahpd speaks AHP 1.1.0
domain: host
status: built
priority: high
created: 2026-10-22
revalidated: 2026-11-21
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0/plan.md
refs:
  - git://88251f665 - main when the plan was checked again against AHP 1.1.0
  - npm://@microsoft/agent-host-protocol@1.1.0 - published 2026-11-13; `SUPPORTED_PROTOCOL_VERSIONS` is still `1.0.0` and `0.9.0`, and `PROTOCOL_VERSION` is `1.1.0`
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - the 1.1.0 types and `CHANGELOG.md`
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - VS Code main on 2026-11-21, which names annotations channels `ahp-annotations:`
  - "[code://packages/sdk/src/host/handshake.ts#L34-L49](../../../../packages/sdk/src/host/handshake.ts#L34-L49) - the `0.10.0` alias and the accepted list, built from the package"
  - "[code://packages/sdk/src/vscode/chatconfig.ts](../../../../packages/sdk/src/vscode/chatconfig.ts) - the per-chat config types vendored from VS Code, which 1.1.0 now ships"
  - "[code://packages/sdk/src/host/canvases.ts#L150-L165](../../../../packages/sdk/src/host/canvases.ts#L150-L165) - a canvas's `state.url`, checked as a web URL"
  - "[code://packages/sdk/src/host/channels.ts#L39-L43](../../../../packages/sdk/src/host/channels.ts#L39-L43) - `ANNOTATIONS_PATH_SEGMENT`, the `<session>/annotations` shape"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1775](../../../../packages/sdk/src/host/sessionmethods.ts#L1775) - `createChat` already reads `params.title`"
  - "[code://packages/agent-claude/src/session/turns.ts#L474-L500](../../../../packages/agent-claude/src/session/turns.ts#L474-L500) - `steer`, which still holds one slot in `ctx.steering`"
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts) - `learnModels`, which compares model ids only"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - Pass 8, the 1.1.0 items and the note that a chat's config inherits on purpose"
  - git://7f7a74ffe - per-chat config and `chatMutable`, built on the vendored types
  - git://20e812035 - a chat's sandbox switch on the chat-scoped config
---

## Goal

ahpd installs AHP 1.1.0 and speaks its wire.
The per-chat config that main already has reads its types from the package.
Several steering messages can wait at once, beside the queued ones, in one list.
A model can name its vendor.
A canvas says its `uri`, and a session's annotations channel is `ahp-annotations:/<uuid>`.
The rest of 1.1.0 waits in the 1.1.0 brief (`git://a3118737e`, now the six `20261124` plans).

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `npm view @microsoft/agent-host-protocol time` on 2026-11-21 - 1.1.0 was published on 2026-11-13.
- `negotiateProtocolVersion` of the 1.1.0 package - an offer of `1.1.0` gets `1.1.0`, `1.2.0` gets `1.2.0`, and `0.10.0` gets nothing.
- `rg "chat/configChanged|chatMutable" packages/*/src` - per-chat config is built in the sdk and agent-acp, on the types in `vscode/chatconfig.ts`.
- `rg "ctx.steering" packages/agent-claude/src` - agent-claude keeps one steering slot.
- `rg "vendor" packages/sdk/src` - no model code reads `SessionModelInfo.vendor`.
- `rg '"@microsoft/agent-host-protocol"' --glob package.json` - nine package files and the root name `^1.0.0`.
- `rg "AHP-1.0.0" --glob README.md` - 14 README files carry the badge.
- `git grep "ahp-annotations" origin/main -- src/vs/platform/agentHost` in VS Code - `buildAnnotationsUri` gives `ahp-annotations:/<uuid>` for an `ahp-session:/<uuid>` session.
- `rg "state.url" ../ahpw/src` - ahpw reads a canvas's `url` in `SessionHeader.tsx:114`.

### Gaps

- The installed package is 1.0.0, so its types have no `ChatState.config`, no `chatMutable` and no `PendingMessage.kind`.
- The 1.1.0 package does not list `1.1.0` in `SUPPORTED_PROTOCOL_VERSIONS`. A `-32005` refusal says "server's version 1.1.0" and lists `1.0.0, 0.9.0, 0.10.0`.
- 1.1.0 says a chat's config does not inherit from its session. ahpd keeps a session's value for the chats that set none. Softov chose this on 2026-11-10.
- ahpd sends a canvas's `url`, which 1.1.0 renames to `uri`.
- ahpd's annotations channel is `<session>/annotations`, the shape 1.1.0 and VS Code main replace.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Rewrite the plan small, with a brief for the rest of 1.1.0 | Softov, 2026-11-21, chose "Rewrite it small + a brief" | - |
| The canvas `uri`, the annotations channel and `CreateChatParams.title` go in this plan | Softov, 2026-11-21, chose "In host/117" | 07, 08, 09 |
| Every range moves to `^1.1.0` in the same files and the same way as 1.0.0 did | (defaulted: sibling [task 02 of 44-p1](../44-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md)) | 01 |
| The handshake keeps the package's list and the `0.10.0` alias, and adds no version of its own | (defaulted: VS Code builds its list from the package; an offer of `1.1.0` already gets `1.1.0`) | 01 |
| A chat's config keeps inheriting a session's value where the chat set none | Softov, 2026-11-10, recorded in UPSTREAM.md Pass 8 | 07 |
| Tasks 02 and 03 are dropped: per-chat config and `chatMutable` are on main | `7f7a74ffe`, `20e812035` | 02, 03 |
| `vscode/chatconfig.ts` gives way to the package's `ChatConfigState`, `ChatConfigChangedAction` and `chatMutable` | (defaulted: the package ships the types the file vendored) | 07 |
| `CreateChatParams.title` is read already, from the untyped `params` every session method reads | `code://packages/sdk/src/host/sessionmethods.ts#L1775` | 07 |
| `chat/configChanged` goes to a client on any version, though 1.1.0 registers it at `1.1.0` | VS Code `ddbdd50a9ed1` `protocolServerHandler.ts` L4944, which holds back only `chat/moved` | 07 |
| Steering and queued entries share `queuedMessages`; `steeringMessage` mirrors the latest steering entry | (defaulted: AHP 1.1.0 `CHANGELOG.md`, *Changed*) | 04 |
| agent-claude holds a list of steering entries, and each read of the CLI input removes the oldest | (defaulted: upstream `0b4e0632b1f`; the input loop in `query.ts` is first in, first out) | 04 |
| A backend that submits a steer at once (cofold, pi, bot) emits no pending entry, as today | (defaulted: no pending state to show) | 04 |
| No backend fills `vendor` yet; the host passes it through from `models()`, and a changed vendor is a changed list | Softov, 2026-10-22 | 05 |
| A canvas says `uri`, an absolute content URI, and the host sends the same value as `url` beside it | VS Code `ddbdd50a9ed1` `withLegacyCanvasState`; a 1.145.2 window reads only `url` | 08 |
| ahpw reads `uri` in its own PR, after this one | (defaulted: ahpw `SessionHeader.tsx:114` reads `url`; a change scoped to ahpd touches no other repo) | 08 |
| A session's annotations channel is `ahp-annotations:/<uuid>` with the session's id, and the session's `annotations.resource` names it | (defaulted: AHP 1.1.0 and VS Code main `ddbdd50a9ed1`) | 09 |
| The old `<session>/annotations` name keeps working beside it | (defaulted: VS Code 1.145.2 `c4453f8ea430` builds the old name itself) | 09 |
| `CreateChatParams.title` has no task of its own | (defaulted: `createChat` reads it already) | 07 |
| The README badges, `docs/sdk/AHP.md` and the UPSTREAM.md boxes move with the package | (defaulted: sibling task 04 of 44-p1) | 06 |

## Proposed architecture

- **Data flow** - the package's types replace the vendored ones. No value changes on the wire except `uri` and the annotations channel.
- **Event flow** - the pending list moves by the 1.1.0 reducer rules.
- **State flow** - a chat's config stays where `7f7a74ffe` keeps it.
- **Layer responsibilities** - workspace: the ranges · sdk: the types, the handshake, `vendor`, the canvas, the annotations channel · agent-claude: the steering list · docs: the badges.
- **Source-of-truth files** - [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/sdk/src/host/channels.ts`](../../../../packages/sdk/src/host/channels.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The 1.1.0 package is installed](task-01-the-1-1-0-package-is-installed.md) | done | - |
| [02 - A chat keeps its own config](task-02-a-chat-keeps-its-own-config.md) | dropped | - |
| [03 - Backend keys are chat-mutable](task-03-backend-keys-are-chat-mutable.md) | dropped | - |
| [04 - Steering messages share the list](task-04-steering-messages-share-the-list.md) | done | 01 |
| [05 - A model names its vendor](task-05-a-model-names-its-vendor.md) | done | 01 |
| [06 - The documents say 1.1.0](task-06-the-documents-say-1-1-0.md) | done | 04, 05, 07, 08, 09 |
| [07 - The chat config reads the package](task-07-the-chat-config-reads-the-package.md) | done | 01 |
| [08 - A canvas says its uri](task-08-a-canvas-says-its-uri.md) | done | 01 |
| [09 - The annotations channel is ahp-annotations](task-09-the-annotations-channel-is-ahp-annotations.md) | done | 01 |

## Risks and tradeoffs

- The old `url` stays on the wire until VS Code drops its transition layer. A later change removes it then.
- VS Code 1.145.2 builds `<session>/annotations` itself, so task 09 serves both names. One action goes to every name a client subscribed to.
- The package's own list leaves out `1.1.0`, so a refusal names a version that its list does not hold. The plan keeps the package's words.
- A chat's config inherits, unlike 1.1.0. A 1.1.0 client that expects a schema default where the session has a value reads the session's value.

## Resume state

- **Done so far:** built and closed on 2026-11-21, on Softov's word; see [implemented.md](implemented.md).
- **Next action:** none.

## Final verification checklist

- [ ] The ranges say `^1.1.0`, and the lockfile resolves 1.1.0.
- [ ] A test: an offer of `1.1.0` gets `1.1.0`, and an offer of `0.10.0` gets `0.10.0`.
- [ ] `vscode/chatconfig.ts` is gone, and the per-chat config tests pass on the package's types.
- [ ] A test: two steers before a read leave no stale entry.
- [ ] A test: a model's `vendor` reaches the root state, and a changed vendor is a changed list.
- [ ] A test: a canvas says `uri`, and `url` beside it.
- [ ] A test: a session's annotations channel is `ahp-annotations:/<uuid>`, and `annotations.resource` names it.
- [ ] The conformance test replays the actions through the 1.1.0 reducers.
- [ ] The gates pass: typecheck, boundary, schema and vitest.
