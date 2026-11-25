---
title: The handshake says its path style and keeps the account
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L441-L446](../../../../packages/sdk/src/host/handshake.ts#L441-L446) - the `initialize` result"
  - "[code://packages/sdk/src/host/handshake.ts#L862-L874](../../../../packages/sdk/src/host/handshake.ts#L862-L874) - `authenticate` reads its params"
  - "[code://packages/sdk/src/host/handshake.ts#L1036-L1042](../../../../packages/sdk/src/host/handshake.ts#L1036-L1042) - the token record"
---

## Objective

`initialize` answers `environment: { pathStyle }` for the daemon's platform. `authenticate` refuses an empty `accountId`, and keeps a given one with the token. No backend reads it yet.

## Files

- `UPDATE: packages/sdk/src/host/handshake.ts:441-446` - add `environment.pathStyle` to the result.
- `UPDATE: packages/sdk/src/host/handshake.ts:862-874` - check `accountId` beside `target`.
- `UPDATE: packages/sdk/src/host/handshake.ts:1036-1042` - keep `accountId` in the token record.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - the path style case.
- `UPDATE: packages/sdk/test/authenticate-target.test.ts` - the account cases.

## Steps

1. Answer `pathStyle: 'windows'` when `process.platform` is `win32`, else `'posix'`, with the VS Code link.
2. Refuse an `accountId` that is present and not a nonempty string, with `accountId must be a nonempty string`.
3. Add `accountId` to the token record when the client gave one.
4. Add a case: `initialize` answers the path style of the platform the test runs on.
5. Add cases: the host refuses an empty `accountId`, and keeps a given one with the token.

## Validation

- `host-handshake.test.ts` and `authenticate-target.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. `Credential.accountId` keeps the hint. The account case is in `authenticate-watching.test.ts`, beside the cases that spend a token.
