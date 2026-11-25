---
title: Plugin import cases time out at twenty seconds on Windows
status: open
date: 2026-11-21
severity: minor
refs:
  - "[code://packages/server/test/plugin-load.test.ts#L342](../../packages/server/test/plugin-load.test.ts#L342) - each first-party plugin loaded from its source, under `IMPORT_CASE_MS`"
  - "[code://tools/wait.ts](../../tools/wait.ts) - `IMPORT_CASE_MS`, 20 s since #420"
  - git://270d6183c - main when the problem was read
---

## Symptom

On 2026-11-21, CI's `windows (2/4)` on #429, run 44943713018, timed out two cases of `plugin-load.test.ts` at 20000 ms:

- `a first-party plugin > loads activepieces with the options schema in its package.json`
- `a first-party plugin > loads computer with the options schema in its package.json`

#420 gave these cases `IMPORT_CASE_MS`, 20 s, for the vite transform of a plugin's source. #429 does not change plugin loading.

## Cause

Unknown. The first import of a plugin's source pays for its transform; on this runner it took more than 20 s.

## Impact

A Windows CI job can fail for no fault in the loader.

## Workaround

None. A rerun is not a fix.
