---
title: A plugin declares a list and kinds
status: done
depends: []
layer: "sdk plugins"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L1818-L1853](../../../../packages/sdk/src/plugins/plugins.ts#L1818-L1853) - `registerChannel`, whose scheme check and handle `registerList` and `registerKind` copy"
  - "[code://packages/sdk/src/plugins/plugins.ts#L2133-L2143](../../../../packages/sdk/src/plugins/plugins.ts#L2133-L2143) - `registerTunnelKind`, the registration `registerKind` copies"
  - "[code://packages/sdk/src/plugins/validate.ts#L1058](../../../../packages/sdk/src/plugins/validate.ts#L1058) - `checkTunnelKind`, whose checks `checkListKind` reuses"
  - "[code://packages/sdk/src/plugins/validate.ts#L351](../../../../packages/sdk/src/plugins/validate.ts#L351) - `declared`, the contract check"
  - "[code://packages/sdk/src/types/kinds.ts](../../../../packages/sdk/src/types/kinds.ts) - `KindOperation`, used as it is"
---

## Objective

`PluginHost` has `registerList` and `registerKind`, and each checks what it is given and records it in the plugin's contribution.
`registerKind` answers a handle with `changed(instance, id)`.

## Files

- `CREATE: packages/sdk/src/types/lists.ts` - `ListDeclaration`, `ListFilter`, `ListKind`, `ListRows`, `ListKindHandle`, and the served forms with `by`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerList` and `registerKind` on `PluginHost`, and `lists` and `kinds` on `Contribution`.
- `UPDATE: packages/sdk/src/types/index.ts` - export the new types.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - add `checkList` and `checkListKind`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - the two registrations, beside `registerTunnelKind`.
- `CREATE: packages/sdk/test/plugin-lists.test.ts` - the registration cases.

## Steps

1. Write the types in `types/lists.ts` from the brief's *Step 1* and *Step 2*, with no `source` and no `addInstance`.
2. Type `ListKind.operations` as `KindOperation[]` and `invoke` as the tunnel kind's `invoke` with a row.
3. Write `checkList`: `name` a slug, `channel` a scheme with `x-`, `title` a string, and `filters`, `search` and `sorts` arrays.
4. Refuse a filter type other than `enum` and `boolean` with a message that names the step that builds it.
5. Refuse `instances: true` and `page` with a message that names the step that builds each.
6. Refuse a `defaultSort` that is not one of `sorts`, with or without `-`.
7. Write `checkListKind` from `checkTunnelKind`: `name`, `title`, `schema`, `operations`, and `invoke` and `rows.list` and `rows.read` as functions.
8. Add `registerList` to the plugin host: `open()`, `checkList`, `declared(by, contracts, 'lists', name)`, and record it in `contribution.lists`.
9. Refuse a second `registerList` of one name in one plugin.
10. Add `registerKind`: `open()`, `checkListKind`, `declared(by, contracts, 'kinds', name)`, and record it in `contribution.kinds` by channel and name.
11. Answer a handle with `changed`, which reaches the list channel after a host exists.
12. Refuse a `changed` that comes before a host exists, as `publish` does.

## Validation

- `packages/sdk/test/plugin-lists.test.ts` registers a complete list and kind, and an empty object for each, as the checker tests do.
- It refuses `instances: true`, `page`, a `range` filter, a `defaultSort` not in `sorts`, and a name the contracts do not list.
- `npx vitest run packages/sdk/test/plugin-lists.test.ts` passes.

## Resume

Built on 2026-11-26. `checkKindOperations` is shared with `checkTunnelKind`, and also checks that `offered` is a function.
