---
title: The docs say anonymous needs a token
status: done
depends: [task-02-anonymous-is-refused-without-a-token.md]
layer: "docs"
refs:
  - "[code://packages/tunnel-devtunnel/README.md#L36-L80](../../../../packages/tunnel-devtunnel/README.md#L36-L80) - the options table and *The tunnel kind*"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L91-L108](../../../../packages/tunnel-devtunnel/src/kind.ts#L91-L108) - the descriptions of `anonymous` and `requireToken`"
---

## Objective

The README, the setting's description and the 0.15 notes say that an anonymous 31546 needs an ahpd token.

## Files

- `UPDATE: packages/tunnel-devtunnel/README.md:36-80` - the options table and *The tunnel kind*.
- `UPDATE: packages/tunnel-devtunnel/README.md:120-130` - the paragraph on the derived token.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:91-96` - the description of `anonymous`.
- `UPDATE: docs/updates/v0_15.md:20` - one *Upgrading* item.

## Steps

1. Say in the README that an anonymous 31546 swaps no token, so a visitor brings `?tkn=<token>`.
2. Say that VS Code cannot connect to an anonymous 31546.
3. Say that the plugin refuses an anonymous 31546 on a daemon with no token and no users.
4. Change the description of `anonymous` to name the token a visitor then needs.
5. Add an *Upgrading* item with the same two rules.

## Validation

- Read the README and the notes for an em dash or a hard wrap.
- The `plugin-load.test.ts` case of the first-party options passes, since the schema text changes.

## Resume

Built on 2026-11-17.
The plugin's `anonymous` option in `package.json` says it too, beyond the task's files.
