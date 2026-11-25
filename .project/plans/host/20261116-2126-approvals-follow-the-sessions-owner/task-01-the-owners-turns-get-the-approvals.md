---
title: The owner's turns get the approvals
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L520-L640](../../../../packages/sdk/src/host/spawn.ts#L520-L640) - `toolReady`, where the approval is built"
  - "[code://packages/sdk/src/host/spawn.ts#L1248-L1255](../../../../packages/sdk/src/host/spawn.ts#L1248-L1255) - `trustedBy`"
---

## Objective

On a host with users, a question in another person's turn gets no approval.
A start that another person sent gets no trust.
The owner's turns get every approval, as today.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:520-640` - `toolReady` reads whose turn it is and leaves out the approvals for another person's turn.
- `UPDATE: packages/sdk/src/host/spawn.ts:1248-1255` - `trustedBy` reads the start's sender by the same rule.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the cases of another person's turn.
- `UPDATE: packages/sdk/test/host-trust.test.ts` - the cases of another person's start.

## Steps

1. Write `approvesFor(session, turn, turnId)`: true with no users file.
2. Read the turn's sender with `senderOf`, and with `kept.sender` when the host holds it no longer.
3. For a turn whose message comes from `user`, answer true only when its sender owns the session.
4. For any other turn with a sender other than the owner, answer false.
5. For the rest, answer the setting of task 02.
6. In `toolReady`, when `approvesFor` is false, skip `getAutoApproval`, so the question asks.
7. Keep the deny rules, the managed rules and the operator's always-ask, which `toolReady` reads before it.
8. In `trustedBy`, answer false for a start that another person's connection sent.
9. Keep the folder a plugin asked for with `session:trust` trusted in every case.

## Validation

- `host-permissions.test.ts`: on a host with users, a member's turn in an admin's `autoApprove` session asks about `rm`.
- `host-permissions.test.ts`: the owner's turn in the same session runs `rm` with no question.
- `host-permissions.test.ts`: a deny rule refuses the call in another person's turn too.
- `host-permissions.test.ts`: on a host with no users file, every turn gets the approvals.
- `host-trust.test.ts`: another person's start gets no trust, and the owner's start gets it.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- An automation's turn carries its owner as its sender, so the sender alone cannot say "nobody sent it". The rule reads the turn's message origin: `user` is a person's turn, and any other kind is unattended.
- `toolReady` skips `getAutoApproval` for a turn with no approvals, in place of building the approval without each one.
- The case that asserted the old behaviour in `host-permissions.test.ts` is replaced by four cases.
- In `host-trust.test.ts`, another person's start now reads no trust.
- In `autoapproval.test.ts`, a turn from somebody other than the owner, in a session read back from the store, now asks.

