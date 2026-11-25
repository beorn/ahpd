---
title: A new nonce keeps the session's decision
status: done
depends:
  - task-01-a-same-nonce-takes-the-new-decisions.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1277](../../../../packages/sdk/src/host/tooling.ts#L1277) - `reconcile` makes a new `HeldPlugin` for a new `nonce`"
  - "[code://packages/sdk/src/host/tooling.ts#L207-L216](../../../../packages/sdk/src/host/tooling.ts#L207-L216) - `HeldPlugin.decision`, the session's own decision"
  - "[code://packages/sdk/src/host/tooling.ts#L1136](../../../../packages/sdk/src/host/tooling.ts#L1136) - `toggleClientPlugin`, which writes that decision"
---

## Objective

A client announces a plugin with a new `nonce`.
The new `HeldPlugin` carries the `decision` of the old one with the same URI from the same client.
A plugin that a person turned off for the session stays off after the new revision.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:1277` - the new `HeldPlugin` for a known URI takes the `decision` of the old one.
- `UPDATE: packages/sdk/test/client-plugins-session.test.ts` - a case for a session toggle and then a new `nonce`.

## Steps

1. In `reconcile`, when `samePlugin` finds no match, find the old `HeldPlugin` of the same client with the same URI.
2. When one exists and holds a `decision`, put that `decision` on the new `HeldPlugin`.
3. In `client-plugins-session.test.ts`, toggle a plugin off for the session.
4. Announce the plugin with a new `nonce`, and read a snapshot.

## Validation

- `client-plugins-session.test.ts`: after the new `nonce`, the plugin's `enablement` starts with `{ kind: 'session', enabled: false }`.
- `client-plugins-session.test.ts`: a plugin with a new URI starts with no session decision.
- `pnpm vitest run packages/sdk/test/client-plugins-session.test.ts` passes.

## Resume
