---
title: A call charges the scope of its key
status: done
depends: [task-01-a-key-is-minted-with-a-scope.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `Principal` gets `keyScope`"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - `principalOf` reads the live record"
  - "[code://packages/sdk/src/usage/scopes.ts](../../../../packages/sdk/src/usage/scopes.ts) - `scopeFor` reads the scope of the key"
  - "[code://packages/server/src/proxy/caller.ts](../../../../packages/server/src/proxy/caller.ts) - the proxy caller, unchanged in code, checked in tests"
  - "[code://packages/sdk/src/host/owners.ts](../../../../packages/sdk/src/host/owners.ts) - a session, unchanged in code, checked in tests"
---

## Objective

A call made with a scoped key is charged to that scope when it names none, and refused when it names another.
A session opened with the key is charged the same way, because both go through `scopeFor`.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:40-130` - adds a `keyScope` getter to `Principal`: the scope of the key it signed in with, read at each question.
- `UPDATE: packages/sdk/src/access/users.ts:992-1114` - `principalOf` defines `keyScope` from the live token record, and nothing when the record is gone.
- `UPDATE: packages/sdk/src/usage/scopes.ts:162-199` - `scopeFor` puts the scope of the key before the primary and refuses a different named scope.
- `UPDATE: packages/sdk/test/scopes.test.ts` - the order and the lock.
- `UPDATE: packages/sdk/test/session-scope.test.ts` - a session opened with a scoped key.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - a proxy call with a scoped key.
- `UPDATE: docs/server/PROXY.md:51-68` - "Who may call" says a key can carry its scope, with pi as the example.
- `UPDATE: docs/server/USERS.md` - `token mint --scope`.

## Steps

1. Add `keyScope` to `Principal` as a read-only optional string.
2. In `principalOf`, add a `keyScope` getter that reads the live token record and answers its `scope`.
3. In `scopeFor`, read `principal.keyScope` before the primary.
4. When the key has a scope and the call names a different one, refuse with `this key charges <scope>, and the call names <named>`.
5. When the call names the key's scope or no scope, resolve the key's scope as `scopeFor` resolves a named scope.
6. Keep the old order for a principal with no `keyScope`.
7. Write the tests and the docs.

## Validation

- `scopes.test.ts`: with no name, the key's scope wins over the primary; the same name is allowed; a different name is refused; a key whose membership was removed is refused with the `may name` sentence.
- `session-scope.test.ts`: a session opened by a principal with `keyScope` is charged to it.
- `proxy-listener.test.ts`: a call with a scoped key and no header writes a record with that team and project; a call with a different `X-AHP-Scope` is 403.
- Run `pnpm typecheck` and `pnpm test`.
- By hand: point pi at the proxy with a scoped key, and send one prompt.

## Resume

- **Done so far:** `Principal` has `keyScope?: string | undefined`, and `principalOf` defines it as a getter over the live token record, answering the record's `scope` and nothing when the record is gone or belongs to somebody else. `scopeFor` reads it first: a call that names nothing is charged to the key's scope over the primary, and a call naming another scope is refused with `this key charges <scope>, and the call names <named>`. A key whose scope the person no longer covers is refused with the `may name` sentence, and a key with no scope keeps the old order. The proxy caller and the session owners needed no code change; they reach it through `scopeFor`.
- **Next action:** none. Task 01 and this one are built and await review.
- **Open questions:** none.
- **Watch out for:** the `scope` picker still offers every membership the person holds, and only the default moves to the key's scope; a client that picks another is refused when the work is charged rather than in the form. The by-hand pi check was not run: this box is not a host for pi and `~/.config/ahpd` is not mine to touch, so the `/v1` path is pinned by `proxy-listener.test.ts` alone.

Files changed by this task: `packages/sdk/src/types/users.ts`, `packages/sdk/src/access/users.ts`, `packages/sdk/src/usage/scopes.ts`, `packages/sdk/test/scopes.test.ts`, `packages/sdk/test/session-scope.test.ts`, `packages/server/test/proxy-listener.test.ts`, `docs/server/PROXY.md`, `docs/server/USERS.md`, and `docs/sdk/USERS.md` for the mint's param table.

