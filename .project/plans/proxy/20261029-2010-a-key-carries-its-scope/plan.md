---
title: A key carries the scope it charges
domain: proxy
status: built
priority: high
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the brief this plan covers, part 1
  - git://5e2b7003 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/users.ts#L271-L299](../../../../packages/sdk/src/types/users.ts#L271-L299) - `TokenRecord` and `MintedToken`, which get `scope`"
  - "[code://packages/sdk/src/types/users.ts#L40-L130](../../../../packages/sdk/src/types/users.ts#L40-L130) - `Principal`, which gets the scope of its key"
  - "[code://packages/sdk/src/access/users.ts#L992-L1114](../../../../packages/sdk/src/access/users.ts#L992-L1114) - `principalOf`, whose `can` and `standing` read the token record at each check"
  - "[code://packages/sdk/src/access/users.ts#L1512-L1569](../../../../packages/sdk/src/access/users.ts#L1512-L1569) - `mintToken`, which checks grants at the mint and gets the scope check"
  - "[code://packages/sdk/src/access/users.ts#L905-L940](../../../../packages/sdk/src/access/users.ts#L905-L940) - the tokens file reader, which checks each field"
  - "[code://packages/sdk/src/access/tokens.ts#L110-L136](../../../../packages/sdk/src/access/tokens.ts#L110-L136) - `x-ahpd/tokens/mint`, which takes `scope`"
  - "[code://packages/server/src/commands/token.ts#L150-L240](../../../../packages/server/src/commands/token.ts#L150-L240) - `ahpd token mint` and `token list`"
  - "[code://packages/sdk/src/usage/scopes.ts#L176-L199](../../../../packages/sdk/src/usage/scopes.ts#L176-L199) - `scopeFor`, which reads the scope of the key"
  - "[code://packages/server/src/proxy/caller.ts#L108-L111](../../../../packages/server/src/proxy/caller.ts#L108-L111) - where a proxy call resolves its scope"
  - "[code://packages/sdk/src/host/owners.ts#L200-L206](../../../../packages/sdk/src/host/owners.ts#L200-L206) - where a session resolves its scope, through the same `scopeFor`"
---

## Goal

A person mints a key that names the team and project its calls are charged to.
A client that sends only a base URL and a key, such as pi, then works for a person with `team:*` or with several projects.
The key's scope is the lock: a call made with it can name only that scope.
The scope is checked at every call, so a membership taken away stops the key without a revoke.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "scopeFor\(" packages/*/src` - the proxy caller and the session owners are the two callers.
- `rg -n "x-ahpd/tokens" packages/sdk/src` - the three token commands, in `access/tokens.ts`.
- `rg -n "grants" packages/sdk/src/access/users.ts` - the grants of a key are checked at the mint and read again in `can`. The scope follows the same pattern.

### Runtime path

```
ahpd token mint --scope backend:ahpc -> mintToken: scopeFor(person, scope) -> tokens file
pi -> /v1 with the key -> callerOf -> users.verify -> principal { token, keyScope }
   -> scopeFor(principal, named) -> key scope, or a 403 -> record charged to backend:ahpc
```

### Gaps

- A token record holds no scope.
- `scopeFor` has no default between a named scope and the primary.
- Nothing refuses a named scope that differs from the scope of the key.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A key holds an optional `scope`, written `team` or `team:project` | Softov, 2026-10-29: "the key when minted need to set ... the team and the project" | 01 |
| The mint refuses a scope the person is not in now, and refuses `team:*` | Softov, 2026-10-29: "only mint if user has access to the team and project" | 01 |
| The scope of a key goes through `scopeFor` at each call | Softov, 2026-10-29: "access need to be check when requesting" | 02 |
| A key with a scope charges only that scope. A named scope that differs is refused with 403 | Softov, 2026-10-29, on the lock: "ok" | 02 |
| A key with no scope works as today | (defaulted: no change for keys that exist) | 02 |
| The scope of a key applies wherever the key signs in, sessions over `/api` too | Softov, 2026-10-29: "yes" | 02 |
| No grant changes: a key for the proxy alone is minted with `proxy:call` and `proxy:models` | Softov, 2026-10-29: "no grants holding proxy:* is better... already existing" | - |
| The principal reads the scope from the token record at each call, as `can` reads the grants | (defaulted: the pattern `principalOf` already uses) | 02 |

## Proposed architecture

- **Data flow** - the mint writes `scope` on the token record. `principalOf` gives the principal a `keyScope` getter that reads the live record. `scopeFor` reads it.
- **Event flow** - none.
- **State flow** - the tokens file stays the one store. The scope is not copied anywhere.
- **Layer responsibilities** - sdk: the record, the mint check, the principal and `scopeFor` · server: the `--scope` flag, the list column and the docs.
- **Source-of-truth files** - [`code://packages/sdk/src/usage/scopes.ts`](../../../../packages/sdk/src/usage/scopes.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A key is minted with a scope](task-01-a-key-is-minted-with-a-scope.md) | done | - |
| [02 - A call charges the scope of its key](task-02-a-call-charges-the-scope-of-its-key.md) | done | 01 |

## Risks and tradeoffs

- A key minted before a project is removed from the install keeps a scope nobody can charge. Each call is refused with the `scopeFor` refusal, and `token list` still shows the scope.
- A client that sends `X-AHP-Scope` with a scoped key and a different scope now gets 403. Before this plan, no key had a scope, so no client breaks.

## Resume state

- **Done so far:** both tasks are implemented. A token record carries an optional `scope`, `ahpd token mint --scope` writes it after checking it against the person's memberships, and `token list` shows it. The principal reads the scope of its key from the live record, `scopeFor` charges to it when a call names none and refuses a call that names another, and the proxy caller and the sessions reach that through `scopeFor` with no code change of their own. The docs say so in `docs/server/PROXY.md`, `docs/server/USERS.md` and `docs/sdk/USERS.md`.
- **Next action:** none for the plan, closed on 2026-11-20 with the 0.15.0 release. The pi check by hand that needs a live host is not recorded as done.
- **Open questions:** none.
- **Watch out for:** `scopeFor` returns nothing on a host with no teams. A key with a scope on such a host is refused at the mint, because there is no team to name. The by-hand pi check in task 02 was not run here, since this box is not a host for pi.

## Final verification checklist

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] A key minted with `--scope backend:ahpc` for a person with `backend:*` and no primary calls `/v1/chat/completions` with no header, and the record names `backend` and `ahpc`.
- [ ] The same call with `X-AHP-Scope: backend:ahpapp` is refused with 403.
- [ ] After the membership is removed from the users file, the next call is refused.
