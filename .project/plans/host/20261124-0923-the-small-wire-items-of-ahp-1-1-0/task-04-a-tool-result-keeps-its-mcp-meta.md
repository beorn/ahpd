---
title: A tool result keeps its MCP meta
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2719-L2730](../../../../packages/sdk/src/host/chatactions.ts#L2719-L2730) - a confirmed result"
  - "[code://packages/sdk/src/host/sessionimport.ts#L250](../../../../packages/sdk/src/host/sessionimport.ts#L250) - an import takes `resultMetadata`"
---

## Objective

A client's `chat/toolCallComplete` with `resultMetadata` keeps it in the call's state, after a confirmation, and after a restart.

## Files

- `UPDATE: packages/sdk/test/tool-result-resources.test.ts` - the three cases.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - only where a case shows `resultMetadata` is lost.

## Steps

1. Add a case: a client completes a call with `resultMetadata`, and the chat state shows it.
2. Add a case: a person confirms the waiting result, and the call still has `resultMetadata`.
3. Add a case: the host restarts, and the restored call has `resultMetadata`.
4. Where a case fails, keep `resultMetadata` at the place that builds the result.

## Validation

- `tool-result-resources.test.ts`: the three cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. No source changed: the call's state keeps `resultMetadata` through the confirmation. The case is in `host-tools.test.ts`. A restart loses it, which `deferred.md` holds.
