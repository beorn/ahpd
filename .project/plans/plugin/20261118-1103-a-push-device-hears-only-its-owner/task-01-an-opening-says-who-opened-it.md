---
title: An opening says who opened it, and a device hears only its owner's
status: done
depends: []
layer: "sdk, push"
refs:
  - "[code://packages/sdk/src/host/routing.ts#L321-L344](../../../../packages/sdk/src/host/routing.ts#L321-L344) - `openedBy`"
  - "[code://packages/push/src/plugin.ts#L209-L234](../../../../packages/push/src/plugin.ts#L209-L234) - `opened` and `audience`"
---

## Objective

`session_opened` names the owner of the connection that opened the session.
On a host with users, a push device hears a session through its client only when that owner is the device's owner.

## Files

- `UPDATE: packages/sdk/src/types/events.ts:90-96` - `owner?: string` on `SessionOpenedEvent`, with its doc comment.
- `UPDATE: packages/sdk/src/host/routing.ts:321-344` - `openedBy` takes the owner and raises it with the event.
- `UPDATE: packages/sdk/src/host/handshake.ts` - both calls of `openedBy` pass `ownerFor(connection)`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - the call of `openedBy` passes `ownerFor(connection)`.
- `UPDATE: packages/push/src/plugin.ts:209-234` - `opened` keeps each client's owner, and `byClient` checks it.
- `UPDATE: packages/sdk/test/plugin-events-fire.test.ts` - the case of `session_opened` naming its owner, under the same client id or not.
- `UPDATE: docs/plugins/PLUGINS.md:1426` - `session_opened` carries `owner`.
- `UPDATE: packages/push/test/plugin.test.ts` - the cases of a borrowed client id and of an admin's opening.
- `UPDATE: packages/push/README.md:119` - a device hears its client's openings only when its owner opened them.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. Add `owner?: string` to `SessionOpenedEvent`, and say it is the opening connection's owner on a host with users.
2. Give `openedBy` a third argument, the owner, and raise it as `owner` when it is not undefined.
3. Pass `ownerFor(connection)` at the three calls of `openedBy`.
4. In the push plugin, keep a map from each session to its clients and the owner each opened it as.
5. On a host with users, make `byClient` true only when the device's `owner` equals the owner kept for its client.
6. Keep `byClient` as it is on a host with no users.
7. Add a case: a device registered with another person's client id hears nothing of that person's session.
8. Add a case: an admin who opens another person's session hears it on the admin's own device.
9. Say the rule in the README's paragraph on `audience`.
10. Add a line to the unreleased notes.

## Validation

- The case of step 7 passes, and fails without step 5.
- The sdk suite, the computer suite and the push suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

