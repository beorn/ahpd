---
title: Grants, policy and usage say gateway
status: done
depends: []
layer: "packages/sdk, packages/server"
refs:
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - the subject, the built-in `member` role and the team key"
  - "[code://packages/sdk/src/access/tokens.ts](../../../../packages/sdk/src/access/tokens.ts) - the bound on minting a team key"
  - "[code://packages/sdk/src/access/policies.ts](../../../../packages/sdk/src/access/policies.ts) - the value types of a policy"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - the grant a call asks for, and its usage source"
---

## Objective

The grant subject is `gateway`, titled `Model gateway`, and a team key holds `gateway:call` and `gateway:models`.
A `model` policy matches the value type `gateway`, and a model call's usage record says `source: 'gateway'`.

## Files

- `UPDATE: packages/sdk/src/access/users.ts` - rename the subject, its title and description, the `member` role's grants and the team key's grants and messages.
- `UPDATE: packages/sdk/src/types/users.ts` - rename the grants in the comments on a team key.
- `UPDATE: packages/sdk/src/access/tokens.ts:155-160` - require `gateway:call` to mint a team key.
- `UPDATE: packages/server/src/commands/token.ts:255` - bound `ahpd token` by `gateway:call`.
- `UPDATE: packages/server/src/proxy/listener.ts` - ask for `gateway:call` and `gateway:models`, and write `source: 'gateway'`.
- `UPDATE: packages/sdk/src/access/policies.ts:38-44` - rename the value type in `MATCHES` and `VALUES`.
- `UPDATE: packages/sdk/src/access/decide.ts:59` - rename the value type in `VALUES`.
- `UPDATE: packages/sdk/src/types/policies.ts:41` - rename the value type in `PolicyValueType`.
- `UPDATE: packages/sdk/src/types/usage.ts:41` - rename the usage source.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - name the model gateway in its comments.
- `UPDATE: packages/sdk/src/types/connectors.ts:25` - name the model gateway in the comment.
- `UPDATE: packages/server/src/proxy/adapters.ts` - name the model gateway in the comment and the capability description.
- `UPDATE: packages/agent-claude/src` - name the model gateway in the comments of `logins.ts`, `plugin.ts` and `session/logins.ts`.
- `UPDATE: packages/sdk/test` - rename the grants, the value type and the source in the tests.
- `UPDATE: packages/server/test` - rename the grants, the value type and the source in the tests.

## Steps

1. Rename the subject `proxy` to `gateway` in the list of subjects and in its operations entry.
2. Set the subject's title to `Model gateway`, and its description to name this host's model gateway.
3. Rename `proxy:read` and `proxy:write` to `gateway:read` and `gateway:write` in the built-in `member` role.
4. Rename `proxy:call` and `proxy:models` to `gateway:call` and `gateway:models` in the team key, its messages and the mint bounds.
5. Make the listener ask for `gateway:call` and `gateway:models`.
6. Rename the policy value type `proxy` to `gateway` in `MATCHES`, both `VALUES` lists and `PolicyValueType`.
7. Rename the usage source `proxy` to `gateway` in the type and in the listener's record.
8. Rename "model proxy" to "model gateway" in the comments the *Files* list names.
9. Keep the nested session proxy, `HTTP_PROXY` and the other outgoing proxy names.
10. Rename the grants, the value type and the source in the sdk and server tests.

## Validation

- `users.test.ts`: the `member` role holds `gateway:read` and `gateway:write`, and the subject's title is `Model gateway`.
- `users-tokens.test.ts`: the host mints a team key with `gateway:call`, and refuses `proxy:call` as a team key's grant.
- `proxy-listener.test.ts`: a role with `gateway:call` calls a model, and the host refuses a role with only `proxy:call`.
- `proxy-policy-usage.test.ts`: a call writes `source: 'gateway'`, and a `model` policy that matches `gateway` applies.
- `git grep -n "proxy:call\|proxy:models\|proxy:read\|proxy:write" -- packages` finds only the refusal cases.
- The sdk, server and computer suites pass, one at a time, and `pnpm typecheck` is clean.

## Resume

