---
title: A key has spend and call limits
domain: policy
status: built
priority: medium
created: 2026-10-29
revalidated: 2026-10-29
refs:
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the brief this plan covers, part 3
  - git://5e2b7003 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/users.ts#L271-L299](../../../../packages/sdk/src/types/users.ts#L271-L299) - `TokenRecord`, which gets `limits`"
  - "[code://packages/sdk/src/types/policies.ts#L25-L100](../../../../packages/sdk/src/types/policies.ts#L25-L100) - `PolicyScope`, `PolicyLimit` and `Policy`"
  - "[code://packages/sdk/src/access/policies.ts#L107-L170](../../../../packages/sdk/src/access/policies.ts#L107-L170) - `limitOf` and `checkPolicy`, which check one limit and one row"
  - "[code://packages/sdk/src/access/decide.ts#L101-L212](../../../../packages/sdk/src/access/decide.ts#L101-L212) - `scoped` and `decide`, which skips every row for a `*:*` holder"
  - "[code://packages/sdk/src/usage/charge.ts#L200-L355](../../../../packages/sdk/src/usage/charge.ts#L200-L355) - `levelOf` and `chargeFor`, where a `cap` row adds its keys and refuses when it is out of room"
  - "[code://packages/server/src/proxy/listener.ts#L503-L540](../../../../packages/server/src/proxy/listener.ts#L503-L540) - `policyFor`, which checks a proxy call only when the switch is on"
  - "[code://packages/sdk/src/access/tokens.ts#L110-L136](../../../../packages/sdk/src/access/tokens.ts#L110-L136) - `x-ahpd/tokens/mint`, which takes `limits`"
  - "[code://packages/server/src/commands/token.ts#L150-L240](../../../../packages/server/src/commands/token.ts#L150-L240) - `ahpd token mint` and `token list`"
---

## Goal

A key holds its own limits, such as 5 USD a day or 100000 tokens a month.
A proxy call made with the key is refused when one of them has no room, with the sentence a policy limit gives.
The limits of a key only narrow.
They never allow a model that no policy allows, and they never stop the charge to a team's limits.
A key minted by an administrator is held to its limits too.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "cap" packages/sdk/src/usage/charge.ts` - a `cap` row adds its keys, refuses the work when it is out of room, and never pays. A key's limits are this case.
- `rg -n "can\('\*:\*'\)" packages/sdk/src/access/decide.ts` - `decide` reads no row for a `*:*` holder, so an administrator's key would skip its limits.
- `rg -n "policiesCheck" packages/server/src/proxy` - the proxy checks a call only with the switch on.

### Runtime path

```
ahpd token mint --limit 5:usd:day -> mintToken: limitOf -> tokens file
pi -> /v1 with the key -> policyFor -> decide: the store's rows + the key's row
   -> chargeFor: the key's row first, as a cap -> 403 with its sentence, or pools with its keys
   -> record: pools hold token:<id>/usd -> the next call reads that total
```

### Gaps

- A token record holds no limits.
- No row is about one key, and the walk has no level before the person.
- A `*:*` holder and a host with the switch off check no limit at all.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A key holds spend and call limits | Softov, 2026-10-29: "a Spend and rate limits on the key also is a good add" | 01 |
| The limits are on the token record, and the store holds no row for them | (defaulted: one place to read, and nothing left behind when a key is revoked) | 01 |
| A limit is written `<amount>:<measure>:<period>`, such as `5:usd:day` | (defaulted: one flag value with no spaces) | 01 |
| A key's limits use the measures of a `model` row: `usd`, `tokens` and `calls` | (defaulted: a key's limits are for the proxy) | 01 |
| A key's limit is always `shared`, because one key has one total | (defaulted: `each` has no member to split by) | 01 |
| The key's limits are one `cap` row, walked before the person's own rows | (defaulted: a cap narrows and never takes the charge from a team) | 02 |
| The key's row allows nothing alone: a call still needs a policy that allows it | (defaulted: a limit only narrows) | 02 |
| A `*:*` holder's key is held to its limits | (defaulted: the brief says an administrator's key gets no limits today, which is the gap) | 02 |
| A key's limits hold with the policy switch off, while a usage store is there | (defaulted: the limits are on the key, not in the policy store) | 02 |
| No rpm or tpm in this plan: the `minute` period is the plan `policy/20261029-2013-a-limit-counts-per-minute` | Softov, 2026-10-29: "we need a rpm tpm" | - |

## Proposed architecture

- **Data flow** - the mint writes `limits` on the token record. `keyRowOf(principal)` turns them into one `cap` row with the scope `token:<id>`. `decide` adds the row to the candidates, and `chargeFor` walks it first.
- **Event flow** - none.
- **State flow** - the tokens file holds the limits. The usage store holds the totals, under the keys `pool:token:<id>/<measure>`.
- **Layer responsibilities** - sdk: the record, the mint check, the row, `decide` and `chargeFor` · server: `policyFor`, the flag, the list line and the docs.
- **Source-of-truth files** - [`code://packages/sdk/src/usage/charge.ts`](../../../../packages/sdk/src/usage/charge.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A key is minted with limits](task-01-a-key-is-minted-with-limits.md) | done | - |
| [02 - A call is held to its key's limits](task-02-a-call-is-held-to-its-key-limits.md) | done | 01 |

## Risks and tradeoffs

- The check is before the call and the record after it, so two calls that start together can both pass an amount. This is how every policy limit works today.
- A key's totals stay in the usage store after a revoke, under keys no row reads.

## Resume state

- **Done so far:** both tasks are implemented (task-01 and task-02), and [implemented.md](implemented.md) is written.
- **Next action:** none. The plan is `built`, and its tasks closed on 2026-11-20 with the 0.15.0 release, which Softov counted as their review.
- **Open questions:** none.
- **Watch out for:** the plans `proxy/20261029-2010-a-key-carries-its-scope` and `usage/20261029-2011-a-record-names-its-key-and-meta` also change `TokenRecord`, `mintToken` and `ahpd token mint`. Rebase on them when they merge first.

## Final verification checklist

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] A key minted with `--limit 2:calls:day` makes two calls, and the third is refused with the key's sentence.
- [ ] The same holds for a key of a person who holds `*:*`, and with the policy switch off.
- [ ] A team row with a limit is still charged for a call the key's row allowed.
