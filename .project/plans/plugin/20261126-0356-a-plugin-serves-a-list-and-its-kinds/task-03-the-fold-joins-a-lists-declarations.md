---
title: The fold joins a list's declarations
status: done
depends: ["task-02-a-plugin-declares-a-list-and-kinds.md"]
layer: "sdk plugins"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L537-L572](../../../../packages/sdk/src/plugins/plugins.ts#L537-L572) - the join of grants and the refusal of a taken channel, which this task reuses"
  - "[code://packages/sdk/src/plugins/plugins.ts#L652-L671](../../../../packages/sdk/src/plugins/plugins.ts#L652-L671) - the fold of tunnel kinds, which the fold of a list's kinds copies"
---

## Objective

The fold joins every plugin's declaration of one list, attaches each kind to the list its `channel` names, and adds the list's grants.
What differs or clashes is a warning on the plugin's row.

## Files

- `UPDATE: packages/sdk/src/plugins/plugins.ts:537-671` - fold `contribution.lists` and `contribution.kinds` beside the channels and the tunnel kinds.
- `UPDATE: packages/sdk/src/types/host.ts` - `lists` on `HostOptions`, the joined lists with their kinds.
- `UPDATE: packages/sdk/test/plugin-lists.test.ts` - the fold cases.

## Steps

1. Join the declarations of one `name` in plugin order: the first gives `channel`, `title`, `description` and `icon`.
2. Join their `filters`, `search` and `sorts`, each field once, in the order first seen.
3. Push a problem for a declaration whose `channel` or text differs from the first.
4. Refuse a list on a scheme that a `registerChannel` took, with a problem that names both plugins.
5. Refuse a `registerChannel` on a list's scheme the same way.
6. Attach each kind to the list its `channel` names, keyed by kind name.
7. Push a problem for a kind on a list that no plugin declared.
8. Push a problem for a second kind of one name in one list.
9. Add the grants `<name>:get`, `<name>:put` and `<name>:delete` through the fold's grants join.
10. Set `options.lists` only when the fold has a list.

## Validation

- Two plugins declare `todo` with different filters, and the fold answers one list with both filters.
- A declaration with another `channel` is a problem, and the first one stands.
- A list on a `registerChannel` scheme is a problem, and the channel stands.
- A kind on a list that nobody declared is a problem, and the fold has no list.
- `npx vitest run packages/sdk/test/plugin-lists.test.ts` passes.

## Resume

Built on 2026-11-26. Between a list and a channel on one scheme, the one whose plugin loaded second is refused.
