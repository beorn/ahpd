---
title: A missing tunnel is made again at start
status: done
depends: []
layer: "tunnel-devtunnel"
---

## Objective

A start whose kept tunnel the service no longer has finds or makes one, and keeps its id.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/service.ts:471-487` - `get` answers nothing on a 404.
- `CREATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-gone.test.ts` - a 404 at `get`, with the SDK stood in.

## Steps

1. Add `notFound(error)`, true for an error whose `response.status` is 404.
2. In `get`, answer `undefined` for a 404 as for a 403.

## Validation

- A test: `get` on a 404 answers nothing, and the entry finds or makes a tunnel.
- Run the tunnel-devtunnel suite as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
The management client is not injectable, so the test stands in for the two SDK packages with `vi.mock`.
Without the fix the test fails with `Tunnel service error: Not Found`, the dev daemon's error.
