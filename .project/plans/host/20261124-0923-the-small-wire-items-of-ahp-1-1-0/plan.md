---
title: The small wire items of AHP 1.1.0
domain: host
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers six of them
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `types/common/commands.ts` for `ResourceReadParams` and `ResourceReadResult`, and `CHANGELOG.md`
  - git://github.com/microsoft/vscode@7e993177c9d9 - VS Code main on 2026-11-24
  - "[code://packages/sdk/src/host/handshake.ts#L441-L446](../../../../packages/sdk/src/host/handshake.ts#L441-L446) - the `initialize` result, which has no `environment`"
  - "[code://packages/sdk/src/host/handshake.ts#L1036-L1042](../../../../packages/sdk/src/host/handshake.ts#L1036-L1042) - the token a connection keeps, with no account"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L84-L96](../../../../packages/sdk/src/host/resourcemethods.ts#L84-L96) - `resourceRead`, which passes no range to the store"
  - "[code://packages/sdk/src/resources/resources.ts#L215-L224](../../../../packages/sdk/src/resources/resources.ts#L215-L224) - the file read, which reads the whole file"
  - "[code://packages/sdk/src/types/resources.ts#L274](../../../../packages/sdk/src/types/resources.ts#L274) - the store's `read`, the shape a plugin scheme implements"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1617-L1618](../../../../packages/sdk/src/host/sessionmethods.ts#L1617-L1618) - `createChat` refuses a first message that is not a person's"
  - "[code://packages/sdk/src/host/chatactions.ts#L2719-L2730](../../../../packages/sdk/src/host/chatactions.ts#L2719-L2730) - a confirmed result, handed on from the call's state"
  - "[code://packages/sdk/src/host/sessionimport.ts#L250](../../../../packages/sdk/src/host/sessionimport.ts#L250) - an import already takes `resultMetadata`"
  - "[code://packages/sdk/src/host/snapshots.ts#L384-L393](../../../../packages/sdk/src/host/snapshots.ts#L384-L393) - a telemetry channel answers no snapshot"
---

## Goal

ahpd serves six small parts of AHP 1.1.0. The handshake says the host's path style. `resourceRead` serves a byte range of a file. A client's message may have any origin the protocol allows. `authenticate` checks and keeps a client's account hint. A tool result keeps its MCP `_meta` as `resultMetadata`. The protocol page says what is served.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -l "pathStyle|EmptyState|accountId" packages/*/src` on 2026-11-24 - no ahpd code names any of them.
- `git grep "localProcessPathStyle"` in VS Code main - every host start sends `environment: { pathStyle }`, `windows` on Windows and `posix` elsewhere.
- `fileSystemResources.ts` in VS Code main - the read ignores `position` and `length`, which 1.1.0 allows.
- `git grep "EmptyState"` in VS Code main's node host - no host code sends `{}`; a telemetry subscribe answers no snapshot, as ahpd's does.
- `agentHostAuthenticationService.ts` in VS Code main - `accountId` must be a nonempty string, and is kept with the token and sent again with it.
- `agentSideEffects.ts` in VS Code main - a confirmed result keeps `resultMetadata`.
- `sdk.d.ts` of the Claude SDK 0.3.325 - a model's MCP tool result streams no `_meta`, so no backend has one to send.

### Gaps

- `initialize` has no `environment`.
- `resourceRead` reads the whole file whatever the range, and answers no `size`.
- `createChat` refuses a first message whose origin is not `user`.
- `authenticate` neither checks nor keeps `accountId`.
- No case shows `resultMetadata` on a completed call, through a confirmation, or after a restore.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass | Softov, 2026-11-24, chose "All of them, in one pass" | - |
| Six plans by feature; this is the one for the small wire items | Softov, 2026-11-24, chose "Six plans by feature" | - |
| `resourceRead` serves the range, ahead of VS Code | Softov, 2026-11-24, chose "Serve the range" | 02 |
| `createChat` keeps refusing a first message that is not a person's | `(defaulted: VS Code main still refuses it; 1.1.0 lifted the rule for two actions only)` | 03 |
| A scheme a plugin serves may ignore the range and answer the whole resource | `(defaulted: 1.1.0 lets a receiver that does not honor ranges answer whole)` | 02 |
| `pathStyle` is the daemon's own platform, as VS Code's `localProcessPathStyle` | `(defaulted: the one answer VS Code gives)` | 01 |
| A telemetry channel keeps answering no snapshot; no `EmptyState` is sent | `(defaulted: VS Code's host sends none, and 1.1.0 allows either)` | 05 |
| `accountId` is checked and kept with the token; VS Code's account selection history is left out | `(defaulted: ahpd has no account picker that reads it)` | 01 |
| `resultMetadata` is kept where it arrives; no backend fills it | `(defaulted: no backend SDK gives an MCP result's _meta)` | 04 |

## Proposed architecture

- **Data flow** - a ranged `resourceRead` passes `{position, length}` to the store's `read`, and the file store answers the slice with `size`.
- **Event flow** - no new action. `chat/toolCallComplete` and `chat/toolCallResultConfirmed` keep `resultMetadata` as the package reducer does.
- **State flow** - a connection's token record gains `accountId`.
- **Layer responsibilities** - sdk host: handshake, `resourceRead`, `createChat` · sdk resources: the file store's ranged read · docs: the protocol page.
- **Source-of-truth files** - [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts), [`code://packages/sdk/src/resources/resources.ts`](../../../../packages/sdk/src/resources/resources.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the handshake says its path style and account](task-01-the-handshake-says-its-path-style.md) | done | - |
| [02 - a read serves a byte range](task-02-a-read-serves-a-byte-range.md) | done | - |
| [03 - a message may have any origin](task-03-a-message-may-have-any-origin.md) | dropped | - |
| [04 - a tool result keeps its MCP meta](task-04-a-tool-result-keeps-its-mcp-meta.md) | done | - |
| [05 - the documents say what is served](task-05-the-documents-say-what-is-served.md) | done | 01, 02, 03, 04 |

## Risks and tradeoffs

- A ranged utf-8 read can end inside a character - the read moves the end back to the last whole character, as 1.1.0 says.
- A backend may get a message whose origin is not a person - each backend reads the text and not the origin, which task 03 checks.

## Resume state

- **Done so far:** tasks 01, 02, 04 and 05, and task 03 dropped, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** the changeset source answers `resourceRead` before the scheme does; a range on a `before` side is ignored, which 1.1.0 allows.

## Final verification checklist

- [ ] `initialize` answers `environment.pathStyle`.
- [ ] A ranged read of a file answers the slice and `size`; a read with no range answers no `size`.
- [ ] A chat made with a first message of `tool` origin starts.
- [ ] An empty `accountId` is refused, and a given one is kept with the token.
- [ ] `resultMetadata` is on a completed call, after a confirmation and after a restore.
- [ ] The sdk and server suites pass, and then the whole repo.
