---
title: The small wire items of AHP 1.1.0 - implemented
date: 2026-11-24
refs:
  - "[code://packages/sdk/src/host/handshake.ts](../../../../packages/sdk/src/host/handshake.ts) - `environment.pathStyle` and `accountId`"
  - "[code://packages/sdk/src/resources/resources.ts](../../../../packages/sdk/src/resources/resources.ts) - `readRange`"
  - "[code://packages/sdk/src/host/resourcemethods.ts](../../../../packages/sdk/src/host/resourcemethods.ts) - the range checks"
---

`initialize` says `environment.pathStyle`. `authenticate` refuses an empty `accountId` and keeps a given one with the token. A ranged `resourceRead` of a file answers the slice and the file's `size`. A client's tool result keeps `resultMetadata` through its confirmation. The protocol page and UPSTREAM.md say each item.

## What was built

- `environment: { pathStyle }` on the `initialize` result.
- `Credential.accountId`, and the check of an empty one.
- `ResourceStore.readRange` and the file store's `readRange`; `resourceRead` checks both bounds and uses it.
- Cases in `host-handshake.test.ts`, `authenticate-watching.test.ts`, `uri-resources.test.ts` and `host-tools.test.ts`.

## Verified

- The four test files pass, and `pnpm typecheck` and `pnpm docs:build` pass.
- The whole repository's `pnpm test`: 610 files, 10515 cases.

## Departures from the plan

- Task 03 is dropped. VS Code main still refuses a `createChat` first message that is not a person's, and the two actions 1.1.0 opened had no check here.
- The range goes to a new `readRange`, not to `read`, so the plugin stores keep their shape.
- `resultMetadata` is not kept after a restart: see [deferred.md](deferred.md).
