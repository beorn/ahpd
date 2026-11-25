---
title: An anonymous hop swaps no token
status: done
depends: []
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L344-L379](../../../../packages/tunnel-devtunnel/src/kind.ts#L344-L379) - the hop and its admit decision"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L503-L518](../../../../packages/tunnel-devtunnel/src/kind.ts#L503-L518) - `access`"
---

## Objective

While port 31546 is anonymous, the hop keeps every token as the visitor wrote it.
A signed-in 31546 swaps the derived token as today.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:201-212` - the hop gains `anonymous`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:344-379` - `hopFor` takes `anonymous`, and the admit decision keeps the token while it is on.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:503-518` - `access` writes `hop.anonymous`.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:554-664` - `update` writes `hop.anonymous` on a moved port and on a saved change.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the anonymous cases.

## Steps

1. Add `anonymous: boolean` to `Hop`, with a comment that says what it is.
2. Pass `anonymous` to `hopFor` from `start` and from the port move in `update`.
3. In the admit decision, answer `keep` when `hop.requireToken` or `hop.anonymous` is on.
4. In `access`, set `hop.anonymous` to true before `service.access` turns anonymous on.
5. In `access`, set `hop.anonymous` to false after `service.access` turns anonymous off.
6. In `update`, apply the same order to a saved change of `anonymous`.

## Validation

- `tunnel-devtunnel.test.ts`: an anonymous 31546 carries the derived token to the daemon unchanged, with and without users.
- `tunnel-devtunnel.test.ts`: a visitor's own token on an anonymous 31546 reaches the daemon unchanged.
- `tunnel-devtunnel.test.ts`: the hop swaps the derived token again once the `anonymous` operation turns anonymous off.
- `tunnel-devtunnel.test.ts`: the existing cases of a signed-in 31546 pass unchanged.
- Run the tunnel-devtunnel suite as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
The hop holds `anonymous`, and the admit decision keeps the token while it or `requireToken` is on.
A failed access change puts the hop back to the value it had, not to off.
A saved change of `person` returns before the access step, as before this plan.
So the hop and the port keep the old access together.
