---
title: A client reports turn timing
domain: host
status: built
priority: low
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Diagnostic timing*"
  - "[code://packages/sdk/src/host/telemetry.ts#L188](../../../../packages/sdk/src/host/telemetry.ts#L188) - spans on `ahp-otlp://traces`, where the records go"
  - "[code://packages/sdk/src/host/handshake.ts#L526](../../../../packages/sdk/src/host/handshake.ts#L526) - the initialize `_meta`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L53](../../../../packages/sdk/src/vscoderootconfig.ts#L53) - the root properties"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/otel/agentHostTiming.ts`, the first-response record and span name; `node/protocolServerHandler.ts#L4279-L4294` and `#L4319-L4329`, the two handlers; `OTEL.md#L29-L47` and `#L89`, the user-interaction record and both capabilities
---

## Goal

VS Code's window measures how long a turn takes to show its first text, and how a person's interaction with a chat went. With a root setting on, ahpd advertises that it takes these records and exports each one as a span, beside its own traces.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "agentHostTiming|chatUserInteraction|reportAgentHostFirstResponse" packages/` - nothing.

### Runtime path

```
vscode/reportAgentHostFirstResponse {record} -> validated -> span vscode.agent_host.first_response on ahp-otlp://traces
vscode/reportChatUserInteraction {record} -> validated -> span with vscode.chat.user_interaction.* on ahp-otlp://traces
```

### Gaps

- No method takes a client's timing, and the host has no setting that gates it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan diagnostic timing, at low priority | Softov, 2026-11-21, "Plan it, at low priority (Recommended)" | 01 |
| A root setting, off by default, gates the records | Softov, 2026-11-21, "A root setting, off by default (Recommended)" | 01 |
| The setting's key is `diagnosticTiming` | (defaulted: ahpd has no diagnostics switch to reuse) | 01 |
| With the setting on, `_meta` carries `vscode.agentHostTiming` and `vscode.chatUserInteractionTiming`; with it off, neither, and both methods answer nothing and export nothing | (defaulted: VS Code L4280, L4320, `OTEL.md#L89`) | 01 |
| The user-interaction validator is VS Code's `src/vs/platform/otel/common/chatUserInteraction.ts`, read from VS Code at `ddbdd50a9ed1`; the host flushes its spans before it answers that record | (defaulted: VS Code L4279-L4294) | 01 |
| An invalid record is refused with `Invalid first-response diagnostic` or `Invalid user interaction timing` | (defaulted: VS Code L4290, L4326) | 01 |
| A record carries no URI and no content; only its validated fields reach the span | (defaulted: VS Code's allowlist) | 01 |
| Both methods need `diagnostics:logs` | (defaulted: the gate's diagnostics grant) | 01 |

## Proposed architecture

- **Data flow** - the method validates the record and gives it to `telemetry.ts` as a span with VS Code's name and attributes.
- **Layer responsibilities** - sdk only.
- **Source-of-truth files** - `packages/sdk/src/host/timing.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A client's timing becomes a span](task-01-a-clients-timing-becomes-a-span.md) | done | - |

## Risks and tradeoffs

- A change of the setting reaches a client only at its next `initialize`, since `_meta` is read once. VS Code has the same limit.

## Resume state

- **Done so far:** [task-01-a-clients-timing-becomes-a-span.md](task-01-a-clients-timing-becomes-a-span.md) is implemented. `host/timing.ts` holds both validators and their spans, `host/telemetry.ts` carries a client's span and the flush, `host/vscodemethods.ts` serves both methods, `host/handshake.ts` advertises both flags while `diagnosticTiming` is on, `vscoderootconfig.ts` declares the setting off by default, and `host/gate.ts` asks `diagnostics:logs` for both. Typecheck and boundary pass.
- **Next action:** none. Merged as #438, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** the user-interaction validator is outside `src/vs/platform/agentHost`; the port is field for field from `src/vs/platform/otel/common/chatUserInteraction.ts` at `ddbdd50a9ed1`.

## Final verification checklist

- [ ] A test: with the setting on, both flags are advertised and a valid record is a span on the traces channel.
- [ ] A test: with the setting off, no flag is advertised and a record exports nothing.
- [ ] A test: an invalid record is refused in VS Code's words.
- [ ] The gates pass: typecheck, boundary, and the sdk suite.
