---
title: A dropped node closes its sessions
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nodes.ts#L485-L498](../../../../packages/sdk/src/nodes.ts#L485-L498) - `session`"
  - "[code://packages/sdk/src/nodes.ts#L564-L571](../../../../packages/sdk/src/nodes.ts#L564-L571) - `drop`"
---

## Objective

`drop` closes the node's control socket and every session socket the node dialled back.

## Files

- `UPDATE: packages/sdk/src/nodes.ts` - the registry keeps each node's session peers, and `drop` closes them.
- `UPDATE: packages/sdk/test/nodes.test.ts` - the cases of a removal with a running session.

## Steps

1. Keep a set of session peers per node, added in `session` and removed when that peer closes.
2. In `drop`, close each session peer of the node, then forget the set.
3. Leave the session peers open when only the control socket closes, as today.
4. Add a case: `remove` of a node with a running session closes that session's socket.
5. Add a case: `add` of a node that is there closes the old session sockets too.
6. Add a case: a control socket that closes by itself leaves the session sockets open.

## Validation

- The case of step 4 passes, and fails without step 2.
- The sdk suite and the computer suite pass, one at a time, as HANDOFF *Tests* says.

## Resume

