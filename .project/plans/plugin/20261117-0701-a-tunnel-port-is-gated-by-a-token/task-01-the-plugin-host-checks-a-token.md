---
title: The plugin host checks a token
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L1153-L1176](../../../../packages/sdk/src/types/plugin.ts#L1153-L1176) - `personKey`"
  - "[code://packages/sdk/src/listen.ts#L159-L195](../../../../packages/sdk/src/listen.ts#L159-L195) - `doorOf`"
  - "[code://packages/server/src/commands/run.ts#L780-L796](../../../../packages/server/src/commands/run.ts#L780-L796) - the door's options"
---

## Objective

A plugin asks `acceptsToken(token)`, and the daemon answers true for its own token or a token that names a person.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:1153-1176` - `acceptsToken` beside `personKey`.
- `UPDATE: packages/sdk/src/listen.ts:159-195` - `tokenAcceptedBy(options)`, the check from the door's options.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1075-1082` - the host option that answers it.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1496` - the plugin host's member.
- `UPDATE: packages/server/src/plugins.ts:954-960` - the option, as `personKey` has it.
- `UPDATE: packages/server/src/plugins.ts:1574` - pass the option on.
- `UPDATE: packages/server/src/commands/run.ts:780-796` - wire `tokenAcceptedBy(door)`.
- `UPDATE: docs/plugins/PLUGINS.md` - the member, beside `personKey`.

## Steps

1. Add `tokenAcceptedBy(options: DoorOptions)` beside `doorOf`, answering `(token) => Promise<boolean>`.
2. Answer true when the token is the daemon's own, compared with `same`.
3. Answer true when `identify` names a principal for the token.
4. Answer false for an empty token, and for anything else.
5. Add `acceptsToken(token: string): Promise<boolean>` to `PluginHost`, with a comment.
6. Pass `tokenAcceptedBy(door)` from `run.ts` through the plugin set, as `personKey` goes.
7. Answer false when the host has no check, so a test host admits nothing.

## Validation

- An sdk test: `tokenAcceptedBy` accepts the daemon's token, a trusted person's token, and a key from `personKey`.
- An sdk test: it refuses an unknown token, an empty one, and a person whose record requires the issuer.
- An sdk test: with no daemon token and no users, it refuses every token.
- Run the sdk, computer and server suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`tokenAcceptedBy` is exported from the sdk, and `run.ts` hands `tokenAcceptedBy(door)` to the plugin set as `acceptsToken`.
The cases are in `packages/server/test/plugin-person-key.test.ts`, which has a users directory and a minted key to test with, not in an sdk test.
