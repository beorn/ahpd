---
title: A list speaks the readers language
status: todo
depends: []
layer: "sdk"
---

## Objective

A list's operations, its kinds' words and the remove question reach a reader in their locale.

## Files

- `UPDATE: packages/sdk/src/lists/channel.ts` - `textOf` and the locale of each reader.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - each kind carries its plugin's catalogs.
- `UPDATE: packages/sdk/src/i18n/pt.json` - the host's words for a list's create, update and remove, with `es.json` beside it.
- `CREATE: packages/sdk/test/list-i18n.test.ts` - the cases.
- `UPDATE: docs/plugins/PLUGINS.md` - the section "A list of your own".

## Steps

1. Carry the registering plugin's catalogs on each kind, as a tunnel kind does.
2. Write the host's words for create, update and remove under `operations.list`.
3. Translate each operation with `operationsIn`, by the reader's locale.
4. Translate the kind's title and description in the `ahpd.channels` entry.
5. Write the docs.

## Validation

- A reader in `pt` reads "Remover" and the kind's own label from its plugin's catalog.
- A reader with no locale reads English.

## Resume
