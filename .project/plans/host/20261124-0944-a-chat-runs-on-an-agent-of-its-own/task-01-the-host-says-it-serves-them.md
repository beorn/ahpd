---
title: The host says it serves chats of other agents
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/vscoderootconfig.ts#L36-L60](../../../../packages/sdk/src/vscoderootconfig.ts#L36-L60) - the VS Code root keys"
  - "[code://packages/sdk/src/host/handshake.ts#L441-L446](../../../../packages/sdk/src/host/handshake.ts#L441-L446) - the `initialize` result"
---

## Objective

The root config has `multipleChatProviders.enabled`, default `true`. While it is on, `initialize` answers `multipleChatProviders: {}` to a client on 1.1.0 or later.

## Files

- `UPDATE: packages/sdk/src/vscoderootconfig.ts:36-60` - add the key, its title and its default, beside `chatMoves.enabled`.
- `UPDATE: packages/sdk/src/host/handshake.ts:441-446` - say the capability under the gate.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - the capability cases.

## Steps

1. Add `multipleChatProviders.enabled` to `vscodeRootProperties`, `boolean`, default `true`, titled `Multiple Chat Providers`.
2. Write a reader of the key beside the reader of `chatMoves.enabled`.
3. Answer `multipleChatProviders: {}` when the key is on and the agreed version is `1.1.0` or later.
4. Add cases: on and 1.1.0 says it, off does not, and 1.0.0 does not.

## Validation

- `host-handshake.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. `multipleChatProvidersOn` reads the key. A window that mirrors its own setting turns it off, since VS Code's default is off.
