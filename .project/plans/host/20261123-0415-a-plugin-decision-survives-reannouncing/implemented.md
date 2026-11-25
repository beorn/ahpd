---
title: A client plugin's decisions survive the client's next announcement - implemented
date: 2026-11-23
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1240-L1355](../../../../packages/sdk/src/host/tooling.ts#L1240-L1355) - `decidedBy`, `signatureOf`, `rechild` and `reconcile`"
  - "[code://packages/sdk/test/client-plugins-session.test.ts](../../../../packages/sdk/test/client-plugins-session.test.ts) - the three new cases"
---

A client that announces a plugin again with a new decision now moves the plugin in the session's list and in the agent's plugin set.
A new revision of a plugin keeps the decision that a person made for the session.

## What was built

- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `decidedBy` serializes a plugin's `enablement` and `childEnablement`, and `signatureOf` includes it.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `reconcile` gives a kept plugin the new announcement and says each plugin whose decisions moved with `session/customizationUpdated`.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - a plugin with a new `nonce` takes the `decision` of the held plugin with the same URI from the same client.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `rechild` puts the new `childEnablement` on the servers of a copy, and keeps the session entry that a toggle on this host wrote.

## Verified

- `client-plugins-session.test.ts`: 18 tests pass, and the three new cases fail on the code before this change.
- `pnpm vitest run packages/sdk`: 5279 tests pass, 5 skipped.
- `pnpm vitest run packages/computer`: 666 tests pass, 4 skipped.
- `pnpm typecheck` and `pnpm boundary` pass.

## Departures from the plan

- `rechild` is new. A copy's servers hold the decisions of the first announcement, so a new `childEnablement` goes on them again.

## Left for later

- None.
