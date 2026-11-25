---
title: A running call moves to the background
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://9003a0a1c - the last commit that holds the brief this plan covers, `.project/briefs/a-running-tool-call-moves-to-the-background.md`
  - git://fd7084712 - the commit the brief's facts were checked at
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ToolCallActionBase._meta`; the reducer replaces `_meta` on `chat/toolCallContentChanged` and on `chat/toolCallComplete` (`tcBaseWithMeta`), and keeps it when the action carries none
  - "[code://packages/sdk/src/host/background.ts#L54-L76](../../../../packages/sdk/src/host/background.ts#L54-L76) - `rowOf`, the one builder of a background row; the module the movable calls sit beside"
  - "[code://packages/sdk/src/types/background.ts#L22-L73](../../../../packages/sdk/src/types/background.ts#L22-L73) - `BackgroundTask`, `BackgroundTasks` and `ChatBackgroundTasks`, the shape the new seam copies"
  - "[code://packages/sdk/src/types/agent.ts#L600-L613](../../../../packages/sdk/src/types/agent.ts#L600-L613) - `Start.backgroundTasks`, the backend seam the new `Start.movableCalls` copies"
  - "[code://packages/sdk/src/types/host.ts#L1678](../../../../packages/sdk/src/types/host.ts#L1678) - `ToolCall`, the context a host tool runs with"
  - "[code://packages/sdk/src/host/tooling.ts#L2522-L2528](../../../../packages/sdk/src/host/tooling.ts#L2522-L2528) - `background()`, the chat-bound seam a host tool's `ToolCall` gets; `movable()` is bound the same way"
  - "[code://packages/sdk/src/host/spawn.ts#L297-L306](../../../../packages/sdk/src/host/spawn.ts#L297-L306) - `withWorkerUri`, a rewrite of a backend's tool call action; the `_meta` keys are laid on in the same place"
  - "[code://packages/sdk/src/host/spawn.ts#L1635-L1638](../../../../packages/sdk/src/host/spawn.ts#L1635-L1638) - a lead chat's backend actions pass through `withMcpContributor` and `toolReady`"
  - "[code://packages/sdk/src/host/spawn.ts#L711](../../../../packages/sdk/src/host/spawn.ts#L711) - a worker chat's backend actions pass through the same rewrites"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L508-L517](../../../../packages/sdk/src/host/vscodemethods.ts#L508-L517) - `vscode/stopBackgroundWork`, the checks and answers the new method copies"
  - "[code://packages/sdk/src/host/gate.ts#L67-L73](../../../../packages/sdk/src/host/gate.ts#L67-L73) - the grant of `vscode/stopBackgroundWork`, with its reason"
  - "[code://packages/sdk/src/host/gate.ts#L171-L176](../../../../packages/sdk/src/host/gate.ts#L171-L176) - `chat/pendingMessageSet` asks for `chat:send`, the grant a steering message takes"
  - "[code://packages/sdk/src/tools/shell.ts#L294-L341](../../../../packages/sdk/src/tools/shell.ts#L294-L341) - the host shell tool: `async` sets a row and is woken; a `sync` command a client lets go is only held"
  - "[code://packages/sdk/src/host/shells.ts#L349-L390](../../../../packages/sdk/src/host/shells.ts#L349-L390) - `start`, which waits for a command's real end and wakes its chat"
  - "[code://packages/sdk/src/host/shells.ts#L400-L420](../../../../packages/sdk/src/host/shells.ts#L400-L420) - `hold`, which keeps a let-go command's shell busy with no row and no wake"
  - "[code://packages/sdk/src/machines/shellcommand.ts#L159-L164](../../../../packages/sdk/src/machines/shellcommand.ts#L159-L164) - `narrowed`, VS Code's way to let a command go on"
  - "[code://packages/sdk/src/host/tooling.ts#L552-L555](../../../../packages/sdk/src/host/tooling.ts#L552-L555) - `shellToolsFor`, the one switch for the host shell tool"
  - "[code://packages/sdk/src/host/tooling.ts#L585-L591](../../../../packages/sdk/src/host/tooling.ts#L585-L591) - `contributingTo`, which already takes the provider"
  - "[code://packages/sdk/src/host/tooling.ts#L691](../../../../packages/sdk/src/host/tooling.ts#L691) - `toolDefinitions`, which calls `contributingTo` with no provider"
  - "[code://packages/agent-pi/src/tools.ts#L18-L30](../../../../packages/agent-pi/src/tools.ts#L18-L30) - a host `bash` replaces pi's own"
  - "[code://packages/agent-cofold/src/turnagent.ts#L379-L382](../../../../packages/agent-cofold/src/turnagent.ts#L379-L382) - cofold's capabilities, built with the host tools in `taken`"
  - "[code://packages/agent-cofold/src/capabilities.ts#L41-L45](../../../../packages/agent-cofold/src/capabilities.ts#L41-L45) - `capabilitiesOf`; `ToolsConfig.shell` turns `shell_exec` off"
  - "[code://docs/sdk/AHP.md#L1144-L1146](../../../../docs/sdk/AHP.md#L1144-L1146) - where `vscode/stopBackgroundWork` is documented"
  - "[code://docs/sdk/TERMINALS.md#L78](../../../../docs/sdk/TERMINALS.md#L78) - where the shell tool's `mode` and its row are documented"
---

## Goal

A person can move a running tool call to the background from ahpw or ahpc.
The call answers its model at once, its work goes on as a row of the chat's background work, and its end wakes the chat.
A running call says in its `_meta` that it can move, and a moved call names its row.
This plan builds the host part and the host shell tool, which pi and cofold now get by default.
The Claude backend's own Bash and subagents are plan [claude/20261121-0824-a-claude-call-moves-to-the-background](../../claude/20261121-0824-a-claude-call-moves-to-the-background/plan.md).

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The brief holds the facts about other projects and about each backend.

### Searches performed

- `rg "'x-ahpd/" packages` - ahpd's own methods are named `x-ahpd/<name>`.
- `rg "toolCallContentChanged" packages/sdk/src/host` - the host already sends that action for a call a backend runs (`terminals.ts`, `spawn.ts`).
- `rg "backgroundToolCall|backgroundWork'" packages` - nothing exists yet.

### Runtime path

```
ahpw/ahpc button -> x-ahpd/backgroundToolCall { chat, toolCallId } -> gate (chat:send)
  -> movable calls of the chat -> the move the provider registered (host tool or backend)
  -> the call answers its model; its work is a row through BackgroundTasks
  -> chat/toolCallComplete passes through spawn.ts, which sets _meta['ahpd.backgroundWork']
  -> the work ends: the row goes, the chat is woken
```

### Gaps

- No call says it can move, and nothing can move it.
- A `sync` shell command a client lets go has no row, no stop and no wake.
- pi and cofold get the host shell tool only when the root config sets `enableCustomTerminalTool`.
- `Not found: an ahpd method served by the host itself under x-ahpd/ - searched "x-ahpd/" in packages/sdk/src/host; the x-ahpd methods come in through options.methods.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| A call that can move says it in `_meta`, and the person moves it with one ahpd method | "the tool need to have a optin ... When running, the information need to carry a flag", 2026-11-21 | 01, 02 |
| The `_meta` keys are `ahpd.backgroundToolCall: true` while the call can move, and `ahpd.backgroundWork: <row id>` once its work is in the background | "yes", 2026-11-21, to the two names suggested | 01 |
| The moved work is a row of the background work the chat already lists | "we could use the same already existing mechanism that lists background processes", 2026-11-21 | 01, 03 |
| The method asks for `chat:send`, the grant of a steering message | "the same permission as steer? because we are not changing, we are letting it continue the turn without the tool real reply", 2026-11-21 | 02 |
| The method moves one call, never all calls of a chat | "One call only", 2026-11-21 | 02 |
| The method is named `x-ahpd/backgroundToolCall` | `(defaulted: ahpd's own methods are x-ahpd/<name>, as x-ahpd/tokens/mint)` | 02 |
| A client knows the host can move a call by the flag on the call; `ahpd.methods` does not list the method | `(defaulted: the flag is the offer, as vscode.stopBackgroundWork on a row is; ahpd.methods stays the list of plugin methods)` | 02 |
| A provider reports `moved(row)` before the call completes, and a move answers only whether it moved | `(defaulted: the completion is where the row is written, and a backend's completion can arrive before a move's answer)` | 01 |
| pi and cofold move the shell through the host shell tool | "Host shell tool", 2026-11-21 | 04 |
| The host shell tool is on by default for pi and cofold; for the others `enableCustomTerminalTool` still decides | "On for pi and cofold", 2026-11-21 | 04 |
| An explicit `enableCustomTerminalTool: false` turns the host shell tool off for pi and cofold too | `(defaulted: a person's explicit setting wins over a default)` | 04 |
| cofold's `shell_exec` is left out when the host `bash` is offered | "Hide shell_exec", 2026-11-21 | 04 |
| A `sync` command let go by VS Code's narrowed claim gets the same row, stop and wake as a moved one | `(defaulted: one let-go command, one behaviour)` | 03 |
| Only ahpw and ahpc draw the button; VS Code shows the row only | "it can be something only for ahpw and ahpc", 2026-11-21 | - |
| ACP calls never move | "when running acp we will only be able to support what it does", 2026-11-21 | - |

## Proposed architecture

- **Data flow** - A provider offers a call with a `move` that answers the row id, or `undefined` when nothing moved. A host tool offers through `ToolCall.movable()`, a backend through `Start.movableCalls`. The host keeps the offers per chat, by tool call id.
- **Event flow** - An offer sends `chat/toolCallContentChanged` with the call's current content and `_meta` plus `ahpd.backgroundToolCall`. The method calls the `move`. A backend's `chat/toolCallComplete` passes through `spawn.ts`, where the host writes the call's last `_meta`: without `ahpd.backgroundToolCall`, and with `ahpd.backgroundWork` when the call moved.
- **State flow** - The offers live in memory beside the background rows and go with the call's completion, the chat's turn end, or the session's end. Nothing is written to disk: a call that outlives a restart is not running.
- **Layer responsibilities** - `packages/sdk`: the offers, the `_meta`, the method, the grant, the host shell tool. `packages/agent-pi`: nothing new; it runs the host `bash`. `packages/agent-cofold`: leaves `shell_exec` out when the host `bash` is offered. `packages/agent-claude`: the other plan.
- **Source-of-truth files** - [`code://packages/sdk/src/host/background.ts`](../../../../packages/sdk/src/host/background.ts) for the offers, [`code://packages/sdk/src/types/background.ts`](../../../../packages/sdk/src/types/background.ts) for the seam.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a call offers to move](task-01-a-call-offers-to-move.md) | done | - |
| [02 - the move method](task-02-the-move-method.md) | done | 01 |
| [03 - the shell tool moves a sync command](task-03-the-shell-tool-moves-a-sync-command.md) | done | 01 |
| [04 - pi and cofold get the host shell](task-04-pi-and-cofold-get-the-host-shell.md) | done | 03 |
| [05 - docs](task-05-docs.md) | done | 02, 03, 04 |

## Risks and tradeoffs

- A backend's completion may carry its own `_meta`, without the keys. The host writes the keys on the pass-through, after the backend, so they always arrive.
- A move can race the call's own end. Then the `move` answers `undefined`, and the method answers `{ backgrounded: false }`, as a late stop does.
- The new default changes the shell of every pi and cofold session. It is the tool VS Code ships, its output shows in a terminal, and `false` turns it off.
- With `chat:send`, a person who may steer a turn may also move a call. The work goes on, and its stop still asks for `chat:cancel`.

## Resume state

- **Done so far:** every task, 2026-11-21, on branch `host/20261121-0824-a-running-call-moves-to-the-background`.
- **Next action:** open the pull request, then write `implemented.md` and set `status: built` once it merges.
- **Open questions:** none.
- **Watch out for:** the reducer replaces the whole `_meta` on content-changed and complete, so every write sends the call's other keys too. A worker chat's actions go through `sendSubagent`, not `dispatch`.

## Final verification checklist

- [ ] A running host `bash` call in a pi session carries `ahpd.backgroundToolCall: true`.
- [ ] `x-ahpd/backgroundToolCall` moves it; the model gets the background answer, and the chat shows the row.
- [ ] The completed call carries `ahpd.backgroundWork` with the row id and no `ahpd.backgroundToolCall`.
- [ ] The command's end removes the row and wakes the chat.
- [ ] A person without `chat:send` is refused.
- [ ] A cofold session has `bash` and no `shell_exec`.
- [ ] `packages/sdk/test/conformance.test.ts` and `packages/sdk/test/wire.test.ts` pass.
