---
title: A plugin whose URL id has a question mark cannot be changed by a client
status: open
date: 2026-10-21
severity: minor
refs:
  - "[code://packages/server/src/plugins.ts#L82-L91](../../packages/server/src/plugins.ts#L82-L91) - `unimportedId` falls back to the spec as written"
  - "[code://packages/server/src/pluginschannel.ts#L452-L461](../../packages/server/src/pluginschannel.ts#L452-L461) - `idParam`, which since #380 takes an id with `/` that matches a configured spec, and still refuses one with `?`"
---

## Symptom

A configured spec that does not resolve is listed in `x-ahpd-plugins` under the spec as its id.
Since #380, `x-ahpd/plugins/enable`, `disable` and `options` take such an id with `/`, when it matches a configured spec.
A URL spec with a query, such as `https://example.invalid/p.tgz?v=2`, has `?` in its id. The commands still refuse it, so a client cannot change that plugin.

## Cause

`unimportedId` answers `nameOf(spec)` when a spec does not resolve or its package is refused.
The commands refuse `?` in an id, because the id is part of a record URI, where `?` starts the query.

## Impact

A client sees the row but cannot enable, disable or edit that plugin.
The command line still can, by the spec as written.
The userinfo of a URL in the id is masked, so no credential leaks.

## Workaround

Use `ahpd plugin enable`, `disable` or `config set` with the spec as written.

## Fix

- Give a plugin that does not resolve a slug id derived from its spec, such as the last path segment.
- Let the commands take the spec as written in a separate param, beside `id`.
- Encode the id in the record URI, and let the commands accept the encoded form.
