---
title: A refused plugin has an id a client can name
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L144-L171](../../../../packages/server/src/plugins.ts#L144-L171) - `unimportedId` and `provisionalOf`"
  - "[code://packages/server/src/pluginschannel.ts#L452-L458](../../../../packages/server/src/pluginschannel.ts#L452-L458) - `idParam`"
---

## Objective

A package plugin the daemon refused is listed under its unscoped package name, and every plugin command takes that id.

## Files

- `UPDATE: packages/server/src/plugins.ts:144-171` - a refused package spec's id is its package name without its scope, through `refusedId`, in `unimportedId` and in the loader.
- `UPDATE: packages/server/src/pluginschannel.ts:452-458` - `idParam` takes an id a row answers, a `/` included.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - the cases of a refused scoped plugin.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. In `unimportedId`, answer the package name without its scope when `locate` refuses a spec that names a package.
2. Keep the spec as the id for a spec that names no package, such as a path or a URL.
3. In `idParam`, take an id that `idOf` answers for a configured spec, before the check for `/` and `?`.
4. Add a case: the list shows a refused `@ahpd/agent-claude` as `agent-claude`.
5. Add a case: `x-ahpd/plugins/update` with `agent-claude` moves that plugin to the version that fits.
6. Add a case: `idParam` refuses an id with `?`, or one no row answers, as today.
7. Add a line to the unreleased notes.

## Validation

- The case of step 5 passes, and fails without steps 1 and 3.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

