---
title: A client's timing becomes a span
status: done
depends: []
layer: "sdk"
refs:
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/otel/agentHostTiming.ts`, `agentHostFirstResponseValidator`
---

## Objective

`vscode/reportAgentHostFirstResponse` and `vscode/reportChatUserInteraction` validate a client's record and export it as a span, while `diagnosticTiming` is on.

## Files

- `CREATE: packages/sdk/src/host/timing.ts` - the two validators and their spans.
- `UPDATE: packages/sdk/src/host/telemetry.ts` - a span from a client's record, and a flush, on the `Telemetry` interface.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - the two methods.
- `UPDATE: packages/sdk/src/host/handshake.ts` - the two `_meta` flags, while the setting is on.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts` - the root setting `diagnosticTiming`, off by default.
- `UPDATE: packages/sdk/src/host/gate.ts` - `diagnostics:logs` for both.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/client-timing.test.ts` - the flags, the spans and the refusals.

## Steps

1. Port VS Code's two validators, field for field.
2. Advertise both flags only while `diagnosticTiming` is on.
3. Answer nothing and export nothing while the setting is off.
4. Refuse an invalid record in VS Code's words.
5. Export a valid record as a span on `ahp-otlp://traces`, with VS Code's span name and attribute prefix.
6. Flush before answering a user-interaction record.

## Validation

- `packages/sdk/test/client-timing.test.ts` - the setting on and off, and an invalid record.
- The sdk vitest suite passes.

## Resume
