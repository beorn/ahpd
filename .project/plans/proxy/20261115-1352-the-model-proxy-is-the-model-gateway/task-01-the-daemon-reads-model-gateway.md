---
title: The daemon reads modelGateway
status: done
depends: []
layer: "packages/server"
refs:
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - `Config` and `RENAMED_KEYS`"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - the field, `FILE_ONLY`, the check and the run's read"
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts) - `DAEMON_KEYS`"
  - "[code://packages/server/src/proxy/providers.ts](../../../../packages/server/src/proxy/providers.ts) - the key's checks and their messages"
  - "[code://packages/server/src/commands/proxy.ts](../../../../packages/server/src/commands/proxy.ts) - the `proxy.list` command"
---

## Objective

The daemon declares `modelGateway` in place of `modelProxy`, and reads neither `modelProxy` nor `proxy`.
The command `gateway.list` answers at `ahpd gateway list` and `GET /gateway/list`.

## Files

- `UPDATE: packages/server/src/config.ts:613` - rename `modelProxy` to `modelGateway` in `Config`.
- `UPDATE: packages/server/src/config.ts:1000-1003` - remove the `proxy` row of `RENAMED_KEYS`, and fix the comment over it.
- `UPDATE: packages/server/src/commands/options.ts` - rename the field, its title, `FILE_ONLY`, the check and the run's read.
- `UPDATE: packages/server/src/rootconfig.ts:38` - rename the key in `DAEMON_KEYS`.
- `UPDATE: packages/server/src/commands/run.ts:718` - read `options.modelGateway`.
- `UPDATE: packages/server/src/proxy/providers.ts` - name `modelGateway` in each message and comment, and in `PROVIDERS_GONE`.
- `UPDATE: packages/server/src/proxy/listener.ts` - name the model gateway in the comments that name the key or the proxy.
- `UPDATE: packages/server/src/http.ts:131` - name the model gateway in the comment over `PROXY_PREFIX`.
- `UPDATE: packages/server/src/commands/proxy.ts` - rename the command to `gateway.list`, its CLI pattern, its route and its summary.
- `UPDATE: packages/server/test` - rename the key and the command in the tests, and add the cases in *Validation*.
- `UPDATE: scripts/completions.mjs` - name the model gateway in its comments and output.

## Steps

1. Rename `modelProxy` to `modelGateway` in `Config`, the field, `FILE_ONLY`, `DAEMON_KEYS` and the run's read.
2. Set the field's title to `Model gateway`.
3. Remove the `{ was: 'proxy', now: 'modelProxy' }` row from `RENAMED_KEYS`, and keep the `http` row.
4. Rename the key in every message of `providers.ts` and `options.ts`, `PROVIDERS_GONE` included.
5. Point `PROVIDERS_GONE` at `docs/server/GATEWAY.md`.
6. Rename the command id to `gateway.list`, the CLI pattern to `gateway list` and the route to `/gateway/list`.
7. Say "model gateway" in the command's summary and description.
8. Rename "model proxy" to "model gateway" in the comments of `packages/server/src`.
9. Keep `proxyHandler`, `ProxyOptions`, `PROXY_PREFIX`, `ProxyConfiguration` and the folder `src/proxy/`.
10. Rename the key and the command in the server tests.

## Validation

- `config-check.test.ts`: the daemon reads a file with `modelGateway` and gives no warning.
- `config-check.test.ts`: a file with `modelProxy` gets `modelProxy is not a setting ahpd knows; ignored`, and no model table.
- `config-check.test.ts`: a file with `proxy` gets the same warning for `proxy`.
- `server-root-config.test.ts` writes and reads `modelGateway`.
- `proxy-list.test.ts` calls `ahpd gateway list` and `GET /gateway/list`.
- `git grep -n modelProxy -- packages scripts` finds nothing.
- The server suite passes, and `pnpm typecheck` is clean.

## Resume

