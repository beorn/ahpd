---
title: A client runs a call only when the agent started it
domain: host
status: built
priority: high
created: 2026-11-24
revalidated: 2026-11-24
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L419-L524](../../../../packages/agent-claude/src/session/stream.ts#L419-L524) - readies a client's call and opens it when Claude's message reports it, before any question"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L421-L498](../../../../packages/agent-claude/src/session/clienttools.ts#L421-L498) - `openCall`, `holdCall`, `allowCall` and `ranByClient`"
  - "[code://packages/agent-claude/src/session/asking.ts#L298-L362](../../../../packages/agent-claude/src/session/asking.ts#L298-L362) - puts the question and moves the held call to `pending-confirmation`"
  - "[code://packages/sdk/src/tools/clientcalls.ts](../../../../packages/sdk/src/tools/clientcalls.ts) - `hold` does nothing for a finished call, and `open` raises a finished call again"
  - "[code://packages/sdk/src/host/catalogue.ts#L2138-L2175](../../../../packages/sdk/src/host/catalogue.ts#L2138-L2175) - the host raises a client's entry from a call in `running`, so the ready must wait too"
  - "[code://packages/agent-acp/src/mapping.ts#L253-L266](../../../../packages/agent-acp/src/mapping.ts#L253-L266) - readies and opens a client's call when the agent reports `in_progress`"
  - "[code://packages/agent-acp/src/session/clientcalls.ts#L194-L253](../../../../packages/agent-acp/src/session/clientcalls.ts#L194-L253) - `callFor` finds the call of a `tools/call` among the open entries"
  - "[code://packages/agent-cofold/src/turnagent.ts#L277-L297](../../../../packages/agent-cofold/src/turnagent.ts#L277-L297) - the pattern: the call is opened where the agent runs the tool"
  - "[code://packages/agent-pi/src/session.ts#L655-L706](../../../../packages/agent-pi/src/session.ts#L655-L706) - opens a call only after its decision, so it needs no change"
  - "https://github.com/microsoft/vscode/blob/7f668a4988e528b6fe5f13fd8e9890affeae678c/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts - readies each call at `content_block_stop` with `confirmed: not-needed`"
  - "https://github.com/microsoft/vscode/blob/7f668a4988e528b6fe5f13fd8e9890affeae678c/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts - raises the client's entry from a call in `running`"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/customizations.md - a client executes when the call reaches `running`"
---

## Goal

A client's tool runs only after the agent is allowed to run it, and its result always reaches the agent.
Today a fast client can run a tool before the person is asked, and the turn then waits forever.

## Reconnaissance

### Searches performed

- `rg "createClientCalls|calls\.open" packages/agent-*/src` - four agents use the holder: Claude, ACP, Pi and Cofold.
- `rg "toolClientExecution" packages/sdk/src` - the holder raises the entry, and the host also derives it from chat state.
- `gh pr list -R ahpio/ahpd` and the six newest unmerged fork branches - no other change to these files.

### Runtime path

```
Claude reports the call -> ready, running -> entry -> the client runs and answers -> the call is completed
Claude asks permission  -> hold does nothing, the call is finished -> the reducer drops the question -> no answer -> the turn waits
```

### What each agent does

| Agent | When the client is asked to run | State |
| --- | --- | --- |
| Claude | When the message reports the call | Wrong, seen on 2026-11-24 |
| ACP | When the agent reports `in_progress`, or the person allows the call | Wrong if the permission request comes after `in_progress`; read, not reproduced |
| Pi | After the decision on the call | Right |
| Cofold | When the tool executes | Right |
| VS Code's Claude | When the content block stops | Same order as Claude here; read, not reproduced |

Seen on session `b58afa60-4079-4ced-a266-f8799a702262`: the chat held `listCommands` completed, the backend held it at `pending-confirmation`, and Claude's transcript had no result for it.
The order of the two was read from the code.

### Gaps

- Not found: a test where the client answers before the question is put.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Claude offers a client's call when the CLI starts its tool handler, not when the message reports it | Softov, 2026-11-24: "yes, check VS Code and the other agents, then plan it", to the fix as proposed | 01 |
| ACP offers it when the `tools/call` arrives, since ACP has the same order | Softov, 2026-11-24, "the other agents" | 02 |
| ahpd differs from VS Code's order | (defaulted: VS Code's order has the same race, and the only other way is to keep the bug) | 01 |
| The `chat/toolCallReady` waits with the entry, so the call stays `streaming` | (defaulted: the host derives the entry from `running`) | 01, 02 |
| A call a person allows is running from the confirmation, as today | (defaulted: the permission is settled then) | 01, 02 |
| A call that ends with no handler is left as it is | (defaulted: [VS Code](https://github.com/microsoft/vscode/blob/7f668a4988e528b6fe5f13fd8e9890affeae678c/src/vs/platform/agentHost/node/agentSideEffects.ts#L1792-L1796) leaves one; a ready there offers a refused call to its client) | 01, 02 |
| Pi and Cofold do not change | [code://packages/agent-pi/src/session.ts#L655-L706](../../../../packages/agent-pi/src/session.ts#L655-L706) | - |

## Proposed architecture

- **Event flow** - reported: `chat/toolCallStart`, the call stays `streaming`. Asked: the question, then the confirmation makes it running. Not asked: the handler makes it running with `chat/toolCallReady`, and the entry goes up.
- **State flow** - a call that ends with no handler is never readied, because the host would offer it. It stays `streaming` until its turn ends, as VS Code leaves one.
- **Layer responsibilities** - each agent: when its call runs. sdk: no change.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - claude-opens-a-call-at-its-handler](task-01-claude-opens-a-call-at-its-handler.md) | done | - |
| [02 - acp-opens-a-call-at-its-request](task-02-acp-opens-a-call-at-its-request.md) | done | - |

## Risks and tradeoffs

- The row says it is preparing until the tool starts - this is correct, since it has not started.
- Claude may run two calls in sequence, so the second waits as `streaming` - today the client runs both at once.
- A repeated message reports a call that is still `streaming` - it must not be handled twice.
- A client can still complete a call at its question - that is the problem [a-client-completes-a-call-it-does-not-run](../../../problems/a-client-completes-a-call-it-does-not-run.md), and it stays there.

## Resume state

- **Done so far:** both tasks, 2026-11-24.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** delaying only the entry fixes nothing, because the host raises it from `running`.

## Final verification checklist

- [x] A client that answers at once cannot run a call before the question is answered, on Claude and ACP.
- [x] The suites of the sdk, of each agent and of the computer package pass.
- [x] With a real Claude session in "Ask Before Edits", ahpw's `listCommands` asks, runs once, and the agent replies.
