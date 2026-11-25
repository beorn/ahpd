---
title: An artifact takes a mode
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/artifacts.ts#L94](../../../../packages/sdk/src/tools/artifacts.ts#L94) - one entry of the tool"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `artifactServerTools.ts` L45-L53 and L243, and the artifact collection that keeps `mode`
---

## Objective

While `chatResources` is on, `add_artifact_or_reference` takes `mode`, `pinned` or `aboveInput`, for a file, and the artifact keeps it with a `modeRevision`.
Without it, `mode` is not offered, and one sent anyway is ignored.

## Files

- `UPDATE: packages/sdk/src/tools/artifacts.ts:94` - the `mode` property and its check.
- `UPDATE: packages/sdk/test/artifacttools.test.ts` - the mode cases.

## Steps

1. Read VS Code's artifact collection, and record in Resume where it keeps `mode` and `modeRevision`.
2. Read what VS Code's window reads of them, and record it in Resume.
3. Offer `mode` only while `chatResources` is on, with VS Code's description.
4. Keep `mode` and `modeRevision` where VS Code keeps them, and ignore `mode` while the key is off.

## Validation

- `packages/sdk/test/artifacttools.test.ts` - the artifact keeps `mode` with the key on, and a new mode moves `modeRevision`.
- The same file - with the key off, the host ignores `mode`.
- The sdk vitest suite passes.

## Resume

`artifacts.ts` has `ARTIFACT_MODES`, `mode` and `modeRevision` on an entry, and VS Code's update and promotion rules in `recordArtifact`. `add_artifact_or_reference` offers `mode` in `forSession` while `chatResources` is on, and reads it in `run` only then. `artifactsIn` keeps a valid stored `mode` and a positive `modeRevision`. The cases are in `artifacttools.test.ts`.
