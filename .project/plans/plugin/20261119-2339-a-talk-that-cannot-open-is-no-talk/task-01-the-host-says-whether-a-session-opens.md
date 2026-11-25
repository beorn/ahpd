---
title: The host says whether a session opens
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L1516-L1560](../../../../packages/sdk/src/plugins/plugins.ts#L1516-L1560) - `sessionKept` and `sessionOwner`, the pattern"
  - "[code://packages/sdk/src/types/plugin.ts#L1180-L1225](../../../../packages/sdk/src/types/plugin.ts#L1180-L1225) - the two methods on `PluginHost`"
  - "[code://packages/sdk/test/plugin-session-owner.test.ts](../../../../packages/sdk/test/plugin-session-owner.test.ts) - the real host the cases fold a plugin into"
---

## Objective

`host.sessionOpens(uri)` answers whether the host can open the session at a URI.
The store keeps the session under that name, and the session runs now or its catalogue restores it.
With no host built over the plugin, it answers what the store keeps.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1180-1225` - `sessionOpens` on `PluginHost`, after `sessionOwner`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1516-1560` - `sessionOpens`, from `sessionKept`'s check and `starts.opens`.
- `CREATE: packages/sdk/test/plugin-session-opens.test.ts` - the cases over a real host.
- `UPDATE: packages/sdk/test/plugin-host.test.ts` - `sessionOpens` with no host built, beside the `sessionKept` cases.
- `UPDATE: docs/plugins/PLUGINS.md:1204` - the third read, and which of the three to ask.

## Steps

1. Add `sessionOpens(uri: string): Promise<boolean>` to `PluginHost`, with a comment that says what it answers and why.
2. Move the body of `sessionKept` into a local `recorded(uri)`, and make `sessionKept` call it.
3. Add `sessionOpens`, which answers `false` when `recorded(uri)` is `false`.
4. Make it return `recorded(uri)` when `starts.opens` is undefined, and `starts.opens(uri)` otherwise.
5. Add the cases and the docs paragraph.

## Validation

- Check these cases in `plugin-session-opens.test.ts`:
  - A store row with no transcript and no process answers `false`, and `sessionKept` answers `true` for it.
  - A session a plugin started answers `true`.
  - A session on a backend's disk answers `true` under its own name and `false` under another.
  - A URI with no row answers `false`.
- `plugin-host.test.ts`: with no host built, `sessionOpens` answers as `sessionKept` does.
- The sdk suite passes.

## Resume

Built on 2026-11-19. With a host built, `sessionOpens` asks `opens` alone.
The store's row is not asked first, because a session a plugin just started has no config row yet, and `opens` already checks the name.
With no host built, it answers the store's row, as `sessionKept` does.

