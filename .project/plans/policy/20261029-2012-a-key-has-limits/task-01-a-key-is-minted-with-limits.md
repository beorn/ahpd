---
title: A key is minted with limits
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/users.ts](../../../../packages/sdk/src/types/users.ts) - `TokenRecord` gets `limits`"
  - "[code://packages/sdk/src/access/policies.ts](../../../../packages/sdk/src/access/policies.ts) - `limitOf`, the check one limit gets"
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - the tokens file reader and `mintToken`"
  - "[code://packages/sdk/src/access/tokens.ts](../../../../packages/sdk/src/access/tokens.ts) - the `limits` param"
  - "[code://packages/server/src/commands/token.ts](../../../../packages/server/src/commands/token.ts) - the `--limit` flag and the list line"
---

## Objective

`ahpd token mint --limit 5:usd:day --limit 100:calls:day` and `x-ahpd/tokens/mint { limits }` write a token record with those limits.
Each limit gets the check a policy limit of a `model` row gets.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:271-299` - adds `limits?: PolicyLimit[]` to `TokenRecord`, and the mint options type gets `limits`.
- `UPDATE: packages/sdk/src/access/policies.ts:107-135` - exports `checkKeyLimits`, which runs `limitOf` for the `model` kind and refuses a pool that is not `shared`.
- `UPDATE: packages/sdk/src/access/users.ts:905-940` - the tokens file reader accepts `limits` only when `checkKeyLimits` accepts them.
- `UPDATE: packages/sdk/src/access/users.ts:1512-1569` - `mintToken` checks `limits` and writes them.
- `UPDATE: packages/sdk/src/access/tokens.ts:36-136` - `x-ahpd/tokens/mint` takes `limits` as an array.
- `UPDATE: packages/server/src/commands/token.ts:110-240` - `--limit <amount>:<measure>:<period>`, repeatable, on `token mint`, and the limits in each `token list` line.
- `UPDATE: packages/sdk/test/policy-checks.test.ts` - `checkKeyLimits`.
- `UPDATE: packages/sdk/test/users-tokens.test.ts` - the mint with limits.
- `UPDATE: packages/server/test/token-command.test.ts` - the flag and the list line.

## Steps

1. Write `checkKeyLimits(limits)`: it is an array, and each item passes `limitOf` for the `model` kind.
2. Make `checkKeyLimits` fill a missing `pool` with `shared`, and refuse `each`.
3. Add `limits` to `TokenRecord` and to the mint options, and check them in the reader and in `mintToken`.
4. Add the `limits` param to `x-ahpd/tokens/mint`, refused with `INVALID_PARAMS` when `checkKeyLimits` refuses it.
5. Add the repeatable `--limit` flag, and split its value at the two colons into amount, measure and period.
6. Refuse a flag value with no two colons, or an amount that is not a number, with one sentence.
7. Add `limit 5 usd/day` to each `token list` line, one per limit.

## Validation

- `policy-checks.test.ts`: `usd`, `tokens` and `calls` pass; `turns` and `each` are refused; a negative amount is refused.
- `users-tokens.test.ts`: a mint with limits writes them with `pool: shared`; a tokens file with a bad limit is reported as broken.
- `token-command.test.ts`: two `--limit` flags reach the record; `--limit 5:usd` is refused; `token list` shows the limits.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

