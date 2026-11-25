---
title: A running tunnel deleted is made again
status: done
depends: [task-01-a-missing-tunnel-is-made-again-at-start.md]
layer: "tunnel-devtunnel"
---

## Objective

A 404 on a running tunnel makes it again, and every record of that connector starts again on it.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/service.ts` - `forget(connector)`, which closes and drops a held tunnel.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts` - `remake(connector)`, and the operations and the page read that call it.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the remake cases.

## Steps

1. Add `forget(connector)` to `Service`, closing the host and dropping the entry.
2. Keep the `Tunnel` and the `report` of each start in `Running`.
3. Add `remake(connector)`: forget the tunnel, close each record's hop, and start each record again.
4. Call `remake` once when `restart`, `update`, `access` or the page read fails with `notFound`.
5. In `stop`, report a record whose tunnel is gone as stopped, and remake the rest of its connector.
6. Retry a start once after `forget` when `add` fails with `notFound`.

## Validation

- A test: a 404 on a page read makes the tunnel again, and the record reports the new URL.
- A test: a restart on a gone tunnel makes it again, and reports a second 404 as an error.
- A test: a stop on a gone tunnel reports `stopped`.
- Run the tunnel-devtunnel and server suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`remake` runs once at a time for each connector, and its starts pass `again`, so a second 404 is reported and nothing loops.
A change in `update` that meets a gone tunnel keeps the new record on the running entry.
So the remake starts the new tunnel with it.
