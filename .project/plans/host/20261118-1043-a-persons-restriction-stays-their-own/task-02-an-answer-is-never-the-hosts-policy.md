---
title: A client's answer is never the host's policy
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2263-L2268](../../../../packages/sdk/src/host/chatactions.ts#L2263-L2268) - the client's decision source, passed to `session.confirm`"
  - "[code://packages/sdk/src/host/spawn.ts#L673-L687](../../../../packages/sdk/src/host/spawn.ts#L673-L687) - the host's own `host_policy` answers, which stay"
---

## Objective

A client's answer that names `host_policy` as its decision source reaches the backend with no decision source.
The host's own answers keep `host_policy`.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:2263-2268` - drop `host_policy` from a client's decision source.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the case of a client's `host_policy`.

## Steps

1. In `chatactions.ts`, read the client's decision source, and pass `undefined` in its place when it is `host_policy`.
2. Keep every other source a client names as it is.
3. Add a case: a client's answer with `host_policy` in its `_meta` reaches the backend's `confirm` with no source.
4. Keep the cases at lines 208 and 216 of `host-permissions.test.ts`, which check the host's own `host_policy`.

## Validation

- The case of step 3 passes, and fails without step 1.
- The sdk suite passes, run alone as HANDOFF *Tests* says.

## Resume

