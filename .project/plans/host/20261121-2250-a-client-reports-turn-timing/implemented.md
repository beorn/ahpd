---
title: A client reports turn timing - implemented
date: 2026-11-22
refs:
  - git://93505f1a1
  - "[code://packages/sdk/src/host/timing.ts](../../../../packages/sdk/src/host/timing.ts)"
  - "[code://packages/sdk/src/host/telemetry.ts](../../../../packages/sdk/src/host/telemetry.ts)"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts)"
---

With the root setting `diagnosticTiming` on, a VS Code window can send its first-response and user-interaction timing records to ahpd, and the host exports each one as the zero-duration diagnostic span the reference host emits. Off, `initialize` offers neither capability and both methods answer with nothing.

## What was built

- [`code://packages/sdk/src/host/timing.ts`](../../../../packages/sdk/src/host/timing.ts) - both validators ported field for field from VS Code at `ddbdd50a9ed1`, the allowlisted attributes each span carries, and the two span names with their attribute prefixes.
- [`code://packages/sdk/src/host/telemetry.ts`](../../../../packages/sdk/src/host/telemetry.ts) - `clientSpan`, which sends a record as an OTLP span of kind 1 with status OK and the record's own attributes, and `flush`, which waits for the spans already written. A notification is handed to its connection before the method answers, so the flush resolves immediately.
- [`code://packages/sdk/src/host/vscodemethods.ts`](../../../../packages/sdk/src/host/vscodemethods.ts) - `vscode/reportAgentHostFirstResponse` and `vscode/reportChatUserInteraction`. Each answers `{}` while the setting is off, refuses an invalid record in VS Code's words, exports a valid one, and the user-interaction method flushes before it answers.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `_meta['vscode.agentHostTiming']` and `_meta['vscode.chatUserInteractionTiming']`, both only while the setting is on.
- [`code://packages/sdk/src/vscoderootconfig.ts`](../../../../packages/sdk/src/vscoderootconfig.ts) - the root setting `diagnosticTiming`, a boolean, off by default.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - both methods ask `diagnostics:logs`.
- [`code://packages/sdk/test/client-timing.test.ts`](../../../../packages/sdk/test/client-timing.test.ts) - the flags, both spans, the off setting, the refusals, and a record with unusable join identifiers.

## Verified

- `pnpm typecheck` passes.
- `pnpm boundary` passes, every package's dependencies declared.
- `packages/sdk/test/client-timing.test.ts` and the sdk suite are written for the owner's run under the lock; they were not run here.

## Departures from the plan

- none.

## Left for later

- none.
