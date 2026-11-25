---
title: Usage groups and filters records by tag
status: done
depends: [task-02-a-record-takes-the-tags-it-passed.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/types/usage.ts#L217-L228](../../../../packages/sdk/src/types/usage.ts#L217-L228) - `UsageKey` and `UsageGroup`"
  - "[code://packages/sdk/src/usage/usage.ts#L456-L480](../../../../packages/sdk/src/usage/usage.ts#L456-L480) - the store's `groups`, which sums each record once"
  - "[code://packages/sdk/src/usage/usage.ts#L486-L501](../../../../packages/sdk/src/usage/usage.ts#L486-L501) - `keysOf`, which gets `tag`"
  - "[code://packages/sdk/src/usage/usage.ts#L790-L823](../../../../packages/sdk/src/usage/usage.ts#L790-L823) - `keysFrom` and `usage://groups`, which read `by`"
  - "[code://packages/sdk/src/usage/usage.ts#L1066-L1090](../../../../packages/sdk/src/usage/usage.ts#L1066-L1090) - `x-ahpd/usage/groups`, which checks `by`"
---

## Objective

`usage://groups?by=tag` and `x-ahpd/usage/groups` with `by: ["tag"]` sum the records under each tag.
A `tag` parameter keeps only the records that hold every tag it names.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts:217-228` - add `tag` to `UsageKey`.
- `UPDATE: packages/sdk/src/usage/usage.ts:486-501` - make `keysOf` give one key set for each tag.
- `UPDATE: packages/sdk/src/usage/usage.ts:456-480` - sum a record into each key set, and apply the tag filter.
- `UPDATE: packages/sdk/src/usage/usage.ts:790-823` - read `tag` off `usage://groups`.
- `UPDATE: packages/sdk/src/usage/usage.ts:1066-1090` - take `tag` as a `by` value and a `tag` list on `x-ahpd/usage/groups`.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the grouping and filter cases.
- `UPDATE: docs/server/USAGE.md` - say what a tag is, where it comes from, and how to group and filter by it.

## Steps

1. Add `tag` to `UsageKey` and to the keys `keysFrom` accepts.
2. Change `keysOf` to return a list of key sets, one per tag, when `by` holds `tag`.
3. Return one key set with no `tag` when `by` does not hold `tag`.
4. Return no key set when `by` holds `tag` and the record has no tags.
5. In the store's `groups`, sum each record into each key set that `keysOf` returned.
6. Add a tag filter to the store's `groups`, which keeps a record only when it holds every tag named.
7. Read `tag` off `usage://groups` as a list split on commas.
8. Take `tag` as a list of strings on `x-ahpd/usage/groups`, and say so in its error text.
9. Add a test: a record with two tags is in both tag groups.
10. Add a test: a group by `user` counts that record once.
11. Add a test: `tag=a,b` keeps only the records with both tags.
12. Add a test: a record with no tags is in no tag group.
13. Write the docs.

## Validation

- The cases of steps 9 to 12 are in `usage-scheme.test.ts`.
- `pnpm --filter @ahpd/sdk test` passes.
- By hand: read `usage://groups?by=tag` on this host after task 03's check, and find the `main` tag.

## Resume

Built 2026-11-21.
The store's `groups` takes the filter as an optional fifth argument, so a store plugin that ignores it still answers.
A tag row's name is the tag.
