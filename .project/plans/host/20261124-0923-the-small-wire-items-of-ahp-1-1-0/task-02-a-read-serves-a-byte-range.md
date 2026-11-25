---
title: A read serves a byte range
status: done
depends: []
layer: "sdk resources"
refs:
  - "[code://packages/sdk/src/host/resourcemethods.ts#L84-L96](../../../../packages/sdk/src/host/resourcemethods.ts#L84-L96) - `resourceRead`"
  - "[code://packages/sdk/src/resources/resources.ts#L215-L224](../../../../packages/sdk/src/resources/resources.ts#L215-L224) - the file read"
  - "[code://packages/sdk/src/types/resources.ts#L274](../../../../packages/sdk/src/types/resources.ts#L274) - the store's `read`"
---

## Objective

A `resourceRead` with `position` or `length` answers that slice of a file and the file's `size`. A read with neither answers the whole file and no `size`. A store that does not serve ranges answers the whole resource.

## Files

- `UPDATE: packages/sdk/src/types/resources.ts:274` - `read` takes an optional `range: { position?: number; length?: number }`, and `Read` an optional `size`.
- `UPDATE: packages/sdk/src/host/resourcemethods.ts:84-96` - refuse a `position` or `length` that is not a whole number of 0 or more, and pass the range to the store.
- `UPDATE: packages/sdk/src/resources/resources.ts:215-224` - read the slice with a file handle, and answer `size` from its stat.
- `UPDATE: packages/sdk/test/uri-resources.test.ts` - the range cases.

## Steps

1. Add the `range` argument to the store's `read` type and the `size` field to `Read`.
2. Refuse a bad `position` or `length` with `INVALID_PARAMS`, in the words of the 1.1.0 schema.
3. Pass the range to the store only when the request has `position` or `length`.
4. In the file read, open the file and read `length` bytes from `position`, or to the end.
5. For a utf-8 answer, move the end back to the last whole character.
6. Answer `size` as the file's byte size when the request has a range.
7. Add cases: a text slice, a binary slice, and a `position` past the end.
8. Add a case: a utf-8 slice that ends inside a character.
9. Add a case: a read with no range answers no `size`.

## Validation

- `uri-resources.test.ts`: the new cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. The range goes to a new optional `readRange` on the store, not to `read`, so no store but the file store changes. A store without it answers whole. A slice that starts inside a character is not text, and comes back base64.
