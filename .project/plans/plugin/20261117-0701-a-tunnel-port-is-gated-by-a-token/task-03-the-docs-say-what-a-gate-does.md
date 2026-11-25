---
title: The docs say what a gate does
status: done
depends: [task-02-a-gate-checks-each-request.md]
layer: "docs"
refs:
  - "[code://packages/tunnel-devtunnel/README.md#L76](../../../../packages/tunnel-devtunnel/README.md#L76) - the README says another port is forwarded as it is"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L103-L108](../../../../packages/tunnel-devtunnel/src/kind.ts#L103-L108) - the description of `requireToken`"
---

## Objective

The README, the setting's description and the 0.15 notes say what `requireToken` does on another port.

## Files

- `UPDATE: packages/tunnel-devtunnel/README.md:76` - the paragraph on another port.
- `UPDATE: packages/tunnel-devtunnel/README.md:45` - the options table row.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:103-108` - the description of `requireToken`.
- `UPDATE: docs/updates/v0_15.md:20` - one *Upgrading* item.

## Steps

1. Say that `requireToken` on another port admits a request only with a token the daemon accepts.
2. Say how a visitor signs in: `?tkn=<token>` once, then the cookie.
3. Say that the gate closes a stream that speaks no HTTP.
4. Say that the gate closes each connection after one request.
5. Name both meanings in the description of `requireToken`: on 31546, and on another port.
6. Add an *Upgrading* item: `requireToken` on another port now gates it.

## Validation

- Read the README and the notes for an em dash or a hard wrap.
- The `plugin-load.test.ts` case of the first-party options passes, since the schema text changes.

## Resume

Built on 2026-11-17.
`docs/plugins/PLUGINS.md` gained *Checking a token*, the place task 01 named.
