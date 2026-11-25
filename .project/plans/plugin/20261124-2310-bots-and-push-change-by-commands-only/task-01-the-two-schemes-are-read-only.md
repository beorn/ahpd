---
title: The two schemes are read only
status: done
depends: []
layer: bot and push plugins
refs:
  - "[code://packages/bot/src/plugin.ts#L672](../../../../packages/bot/src/plugin.ts#L672) - the registration"
  - "[code://packages/push/src/plugin.ts#L167](../../../../packages/push/src/plugin.ts#L167) - the registration"
---

## Objective

`resourceWrite` and `resourceDelete` on `bot://` and `push://` are refused. Reads, lists, watches and the commands work as before.

## Files

- `UPDATE: packages/bot/src/plugin.ts` - registers the provider without `write` and `delete`.
- `UPDATE: packages/push/src/plugin.ts` - registers the provider without `write` and `delete`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the cases through the host use the commands, and one case per refusal.
- `UPDATE: packages/push/test/provider.test.ts` - the same for a device.

## Steps

1. Register each provider with the read, list, resolve and watch members only.
2. Pass the whole provider to `botMethods` and `pushMethods` as today.
3. Change each case that writes by resource through a host to the command.
4. Add one case per scheme for a refused write and a refused delete.

## Validation

- The bot, push and server suites pass.
- `rg -n "resourceWrite|resourceDelete" packages/bot/test packages/push/test` shows the refusals alone.

## Resume

Done 2026-11-24. See [implemented.md](implemented.md).
