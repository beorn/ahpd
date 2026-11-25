---
title: A canvas says its uri
status: done
depends: [01]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/canvases.ts#L150-L165](../../../../packages/sdk/src/host/canvases.ts#L150-L165) - the check of a canvas's `state.url`"
  - "[code://packages/sdk/src/host/canvases.ts#L245-L256](../../../../packages/sdk/src/host/canvases.ts#L245-L256) - `url` cleared when the provider is gone"
  - "[code://packages/server/src/wire.ts#L114](../../../../packages/server/src/wire.ts#L114) - the wire log redacts a canvas's `url`"
  - "[code://packages/sdk/src/types/plugin.ts#L511](../../../../packages/sdk/src/types/plugin.ts#L511) - a plugin's `open`, typed with the package's `CanvasState`"
---

## Objective

A canvas's state says `uri`, an absolute content URI, as AHP 1.1.0 renames the experimental `CanvasState.url`.
The host sends the same value as `url` beside it, as VS Code's host does while a 1.145 window reads only `url`.

## Files

- `UPDATE: packages/sdk/src/host/canvases.ts:150-165` - the check reads `state.uri`.
- `UPDATE: packages/sdk/src/host/canvases.ts:245-256` - `uri` is cleared when the provider is gone.
- `UPDATE: packages/server/src/wire.ts:114` - the wire log redacts `uri`.
- `UPDATE: packages/sdk/test/host-canvases.test.ts` - the cases say `uri`.

## Steps

1. Run `rg "\\.url\\b|url:" packages/*/src` near each canvas, and list every place a canvas says `url`.
2. Rename each to `uri`, keeping the absolute HTTP(S) check.
3. Rename the redaction in `wire.ts`.
4. Record in Resume that ahpw `src/resources/sessions/SessionHeader.tsx:114` reads `url`, for its own PR.

## Validation

- `packages/sdk/test/host-canvases.test.ts` - a canvas says `uri` and no `url`. The host refuses a relative `uri`.
- `pnpm typecheck` passes against the package's `CanvasState`.
- The sdk and server vitest suites pass.

## Resume

A canvas says `uri`: the host's check, the clear when a plugin goes, the wire log's redaction, the example plugin, the tests and the docs. The check keeps absolute http(s) URLs only, which AHP 1.1.0 allows, since it lets the host choose the sources it serves. `pnpm typecheck` is clean. Six files pass, 156 cases. ahpw `src/resources/sessions/SessionHeader.tsx:114` reads `url` and needs its own PR.

On 2026-11-21 the host also sends `url` beside `uri`, in `sent` in `canvases.ts`, for the actions and the snapshot. VS Code main does the same in `withLegacyCanvasState` (`common/agentHostProtocolTransition.ts`, `ddbdd50a9ed1`), and a 1.145.2 window reads only `canvas.url`. The wire log redacts both keys. Seven files pass, 173 cases.
