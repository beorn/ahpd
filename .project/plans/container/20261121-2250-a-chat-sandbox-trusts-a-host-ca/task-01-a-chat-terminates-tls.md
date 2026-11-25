---
title: A chat that terminates signs with the host CA
status: todo
depends: []
layer: "computer"
refs:
  - https://github.com/anthropics/sandbox-runtime/blob/v0.0.83/README.md#tls-termination - the settings
  - "[code://packages/computer/src/sandbox.ts#L210-L222](../../../../packages/computer/src/sandbox.ts#L210-L222) - the settings and `advanced.runtime`"
---

## Objective

A chat whose settings ask for termination gets the scope's host CA in `network.tlsTerminate`, and no sandbox reads the CA's key.

## Files

- `CREATE: packages/computer/src/sandboxca.ts` - the CA by scope, made with `generateCa`, kept owner-only in the configuration folder.
- `UPDATE: packages/computer/src/sandbox.ts` - the CA's paths in `tlsTerminate` for a chat that terminates, and the key in `denyRead`.
- `CREATE: packages/computer/test/sandboxca.test.ts` - the CA made once, its paths in the settings, and the key denied.

## Steps

1. Read whether a chat terminates: `network.tlsTerminate` or `credentials` in its `advanced.runtime`.
2. Make the scope's CA once with `generateCa`, and write it owner-only.
3. Put the CA's `caCertPath` and `caKeyPath` in that chat's `tlsTerminate`, over any paths in `advanced.runtime`.
4. Put the CA's key in every sandbox's `denyRead`.
5. Leave the settings of a chat that does not terminate unchanged.

## Validation

- `packages/computer/test/sandboxca.test.ts` - the CA, the settings and the denied key.
- The computer vitest suite passes.

## Resume
