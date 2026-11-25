---
title: Anonymous is refused without a token
status: done
depends: [task-01-an-anonymous-hop-swaps-no-token.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L386-L420](../../../../packages/tunnel-devtunnel/src/kind.ts#L386-L420) - `start`"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L207-L213](../../../../packages/tunnel-devtunnel/src/plugin.ts#L207-L213) - `guarded`"
---

## Objective

An anonymous 31546 does not start, and anonymous does not turn on there, while the daemon has no connection token and no users.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:60-72` - a constant for the refusal's text, beside `REFUSED`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:386-420` - `start` refuses an anonymous 31546 on an open daemon.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:503-518` - `access` refuses `on: true` there.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:554-664` - `update` refuses a saved `anonymous: true` there.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the refusal cases.

## Steps

1. Add `openToAnyone(port, anonymous)`: true for 31546, anonymous, `guarded()` false and `hasUsers` not true.
2. Add a refusal text that says to set a connection token or a users file.
3. In `start`, report the refusal as the row's error, and put no port on the tunnel.
4. In `access`, report the refusal and keep the record's `anonymous` as it was.
5. In `update`, report the refusal and leave the port's access as it was.
6. Raise an `error` alert on the row with the same text, as `REFUSED` does.

## Validation

- `tunnel-devtunnel.test.ts`: with no token and no users, an anonymous 31546 does not start, and the row says why.
- `tunnel-devtunnel.test.ts`: with no token and no users, the host refuses the `anonymous` operation with `on: true`, and the record keeps `anonymous: false`.
- `tunnel-devtunnel.test.ts`: with a token, or with users, an anonymous 31546 starts.
- `tunnel-devtunnel.test.ts`: an anonymous tunnel on another port starts on an open daemon, since it does not reach the daemon.
- Run the tunnel-devtunnel and server suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`OPEN_TO_ANYONE` is the refusal text, and `refuseOpen` raises the alert and reports it.
A refused start reports `status: error`, and a refused change reports only the error, so the port keeps its access.
