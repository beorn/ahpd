---
title: A call is held to its key's limits
status: done
depends: [task-01-a-key-is-minted-with-limits.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/policies.ts](../../../../packages/sdk/src/types/policies.ts) - `PolicyScope` gets `token:<id>`"
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `Principal` gets `keyLimits`"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - `principalOf` reads the live record"
  - "[code://packages/sdk/src/access/policies.ts](../../../../packages/sdk/src/access/policies.ts) - `checkPolicy` refuses `token:` from the store"
  - "[code://packages/sdk/src/access/decide.ts](../../../../packages/sdk/src/access/decide.ts) - `scoped` and `decide`"
  - "[code://packages/sdk/src/usage/charge.ts](../../../../packages/sdk/src/usage/charge.ts) - `levelOf` and `chargeFor`"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `policyFor`"
---

## Objective

A proxy call made with a key that has limits is refused when one of them has no room.
The record of an allowed call is charged to the key's pools, so the next call reads the new total.

## Files

- `UPDATE: packages/sdk/src/types/policies.ts:25-31` - adds `token:${string}` to `PolicyScope`, for the row a key's limits make. The store never holds one.
- `UPDATE: packages/sdk/src/types/users.ts:40-130` - adds a `keyLimits` getter to `Principal`: the limits of the key it signed in with.
- `UPDATE: packages/sdk/src/access/users.ts:992-1114` - `principalOf` defines `keyLimits` from the live token record.
- `UPDATE: packages/sdk/src/access/policies.ts:136-170` - `checkPolicy` refuses the scope `token:`, and a `pool` that starts with `token:`.
- `UPDATE: packages/sdk/src/access/decide.ts` - adds `keyRowOf`, `scoped` matches `token:` against `principal.token`, and `decide` adds the key's row to an allowed decision.
- `UPDATE: packages/sdk/src/usage/charge.ts:202-210` - `levelOf` puts a `token:` row before the person's own rows.
- `UPDATE: packages/server/src/proxy/listener.ts:503-540` - `policyFor` walks the key's row with the switch off too, when a usage store is there.
- `UPDATE: packages/sdk/test/decide.test.ts` - the key's row in the candidates.
- `UPDATE: packages/sdk/test/charge.test.ts` - the walk with a key's row.
- `UPDATE: packages/sdk/test/policy-scheme.test.ts` - `token:` refused from the store.
- `UPDATE: packages/server/test/proxy-policy-usage.test.ts` - a call refused by its key's limit.
- `UPDATE: docs/sdk/POLICY.md:143-160` - "How a limit is counted" names the key's row.
- `UPDATE: docs/server/USERS.md:37-59` - `token mint --limit`.
- `UPDATE: docs/server/PROXY.md` - "What a refusal means" names a key's limit.

## Steps

1. Add `keyLimits` to `Principal` and to `principalOf`, read from the live token record.
2. Write `keyRowOf(principal)`: nothing without `token` and `keyLimits`.
3. Make the row `{ id: token:<id>, scope: token:<id>, kind: model, effect: allow, match: { model: ['*'] }, limits, cap: true, pool: token:<id> }`.
4. In `scoped`, match a `token:` row only when the name equals `principal.token`.
5. In `decide`, add the key's row to the candidates of an allowed `model` decision.
6. Never count the key's row as an allow.
7. For a `*:*` holder, answer `{ allowed: true, candidates: [keyRow] }` when the key has a row.
8. In `levelOf`, give a `token:` row a level before `user`.
9. Make `checkPolicy` refuse `token:` as a scope and as the start of a `pool`.
10. When the switch is off, make `policyFor` build a decision of the key's row alone.
11. Walk that decision with `chargeFor`.
12. Write the tests and the docs.

## Validation

- `decide.test.ts`: a key's row alone does not allow a model; with an allow row it is a candidate; a `*:*` holder's key gets it.
- `charge.test.ts`: the key's row is walked first; out of room, it refuses with `token:<id> has no room`; with room, it adds its keys and a team row still pays.
- `policy-scheme.test.ts`: a body with `scope: token:x` or `pool: token:x` is refused.
- `proxy-policy-usage.test.ts`: with `2:calls:day`, the third call is refused; the same with the switch off.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

- **Done so far:** `keyRowOf` in `packages/sdk/src/access/decide.ts` writes the one row a key's limits make, `{ id: token:<id>, scope: token:<id>, kind: model, effect: allow, match: { model: ['*'] }, limits, cap: true, pool: token:<id> }`, and answers nothing without a `token` id or without limits. `scoped` matches a `token:` row against `principal.token`. `decide` writes the row for a `model` check only, adds it to an allowed decision and never counts it as an allow; a `*:*` holder gets it alone. `levelOf` in `packages/sdk/src/usage/charge.ts` puts a `token:` row before the person's own, so the cap is walked first and a team row is still charged. `policyFor` in `packages/server/src/proxy/listener.ts` walks the key's row alone when `policiesCheck` is off and a store is there. `checkPolicy` refuses a `token:` scope and a `token:` pool. Tests: `decide.test.ts` has 5 cases for the key's row (including `*:*` and no row without limits), `charge.test.ts` has 4 (walk order, the refusal sentence, the keys added, a team row still paid), `policy-scheme.test.ts` refuses both a key's scope and its pool, and `proxy-policy-usage.test.ts` refuses the third of `2:calls:day` with the switch on and off and records the pools of an allowed call. `docs/sdk/POLICY.md`, `docs/server/USERS.md` and `docs/server/PROXY.md` name the row, `--limit` and the 403.
- **Next action:** none; the plan's final verification checklist is next.
- **Files:** `packages/sdk/src/access/decide.ts`, `packages/sdk/src/usage/charge.ts`, `packages/server/src/proxy/listener.ts`, `packages/sdk/src/access/tokens.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/decide.test.ts`, `packages/sdk/test/charge.test.ts`, `packages/sdk/test/policy-scheme.test.ts`, `packages/server/test/proxy-policy-usage.test.ts`, `docs/sdk/POLICY.md`, `docs/server/USERS.md`, `docs/server/PROXY.md`, this task file, the plan and `implemented.md`.
- **Open questions:** none.
- **Departures:** the key's row is written for a `model` decision only, so an agent or a computer check gets no row: the measures a key holds are a `model` row's.
- **Watch out for:** `packages/sdk/src/types/policies.ts`, `packages/sdk/src/types/users.ts`, `packages/sdk/src/access/users.ts` and `packages/server/src/commands/token.ts` were built by task 01, whose test and doc changes are in the commit before this one. The other builds change the same files.

