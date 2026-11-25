---
title: A message may have any origin
status: dropped
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1617-L1618](../../../../packages/sdk/src/host/sessionmethods.ts#L1617-L1618) - the refusal 1.1.0 removes"
---

## Objective

`createChat` takes a first message of any origin that 1.1.0 allows, as `chat/turnStarted` and `chat/pendingMessageSet` already do.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1617-1618` - remove the refusal of a first message that is not a person's.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - the case of a first message with another origin.

## Steps

1. Remove the check that the first message's origin is `user`.
2. Keep the check that the first message is a message.
3. Run `rg "origin\)\.kind|origin\.kind" packages/*/src` and confirm that no backend refuses a turn by its origin.
4. Change the case that expects the refusal into one where a chat starts with a first message of `tool` origin.

## Validation

- `host-chats.test.ts`: the changed case.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Dropped on 2026-11-24. AHP 1.1.0 removed the person-only rule for `chat/turnStarted` and `chat/pendingMessageSet`, and ahpd checks neither: it only fills a missing origin. VS Code main still refuses a `createChat` first message that is not a person's (`agentService.ts` at `7e993177c9d9`, L7759-L7761), so ahpd keeps that check.
