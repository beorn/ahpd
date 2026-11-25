---
title: A gate checks each request
status: done
depends: [task-01-the-plugin-host-checks-a-token.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L56-L100](../../../../packages/tunnel-devtunnel/src/forward.ts#L56-L100) - the head and its `tkn` helpers"
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L191-L220](../../../../packages/tunnel-devtunnel/src/forward.ts#L191-L220) - `carry`, the pattern of the gate"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L350](../../../../packages/tunnel-devtunnel/src/kind.ts#L350) - where a port gets a handler"
---

## Objective

With `requireToken` on, a port other than 31546 is answered by a gate that admits a request only with a token the daemon accepts.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/forward.ts` - `gate(stream, to, accepts, log)`, beside `carry`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:158-161` - the kind's plugin takes `acceptsToken`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:386-460` - `start` sets the gate on a port with `requireToken`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:554-664` - `update` sets or clears the gate on a saved change.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the gate cases.

## Steps

1. Add `gate` to `forward.ts`, reading the head as `carry` does.
2. Take the token from `tkn`, else from the cookie `ahpd-tkn`.
3. Answer `401` and end the stream when `accepts` answers false or no token is there.
4. For an accepted `tkn`, answer `302` to the target without `tkn`, with the cookie set.
5. Set the cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and `Max-Age=604800`.
6. For an accepted cookie, remove `ahpd-tkn` from the `Cookie` header and `tkn` from the target.
7. Set `Connection: close` on a request that is not an upgrade, then carry it to the port.
8. Close a stream whose first bytes are not an HTTP request head.
9. In `start`, register the gate with `service.carry` before the port goes on the tunnel.
10. In `update`, set the gate when `requireToken` turns on, and clear it when it turns off.
11. Leave 31546 to its hop, whose `requireToken` keeps its meaning.

## Validation

- `tunnel-devtunnel.test.ts`: a request with no token gets `401`, and nothing reaches the port.
- `tunnel-devtunnel.test.ts`: an accepted `?tkn=` gets `302` without `tkn`, and a `Set-Cookie` of `ahpd-tkn`.
- `tunnel-devtunnel.test.ts`: an accepted cookie reaches the port without `ahpd-tkn`, and with `Connection: close`.
- `tunnel-devtunnel.test.ts`: a WebSocket upgrade with an accepted cookie keeps `Connection: Upgrade`.
- `tunnel-devtunnel.test.ts`: a token `accepts` refuses gets `401`, cookie or `tkn`.
- `tunnel-devtunnel.test.ts`: a saved `requireToken` off pipes the port raw again.
- Run the tunnel-devtunnel suite as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
The gate is a hop that maps nothing, made by `gateFor`, so every path that closes a hop takes the gate down too.
`carry` and `gate` share `dial`.
`headFrom` now closes a stream whose first line is not an HTTP request line, on 31546 too, rather than wait for a head.
The test daemon records `cookie` and `connection`, so the upgrade case on 31546 now expects `connection: Upgrade`.
