---
title: The held catalogue case measures less than its wait on Windows
status: open
date: 2026-11-21
severity: minor
refs:
  - "[code://packages/sdk/test/host-catalogue-held.test.ts#L145-L161](../../packages/sdk/test/host-catalogue-held.test.ts#L145-L161) - the case, which expects the first listing to take at least `WAIT - 20` ms"
  - git://270d6183c - main when the problem was read
---

## Symptom

On 2026-11-21, CI's `windows (2/4)` on #429, run 44943713018, failed `host-catalogue-held.test.ts`: `the catalogue is held > waits for the first listing and answers the next without another pass`.
It said `expected 78 to be greater than or equal to 80`: the first listing took 78 ms by `Date.now()`, against a backend that waits `WAIT`, 100 ms.
#429 does not change the catalogue.

## Cause

Unknown.
The case measures the wait with `Date.now()`, and a Windows timer can fire early by up to its tick of about 16 ms. The backend's timer may also start before the case reads its first `Date.now()`.

## Impact

A Windows CI job can fail for no fault in the catalogue.

## Workaround

None. A rerun is not a fix.
