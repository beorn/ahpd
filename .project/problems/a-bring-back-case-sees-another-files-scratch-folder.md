---
title: A bring-back case sees another file's scratch folder
status: open
date: 2026-11-22
severity: minor
refs:
  - "[code://packages/computer/test/computer-git-fetch.test.ts#L234](../../packages/computer/test/computer-git-fetch.test.ts#L234) - `leftOver` reads the whole temporary folder of the run"
  - "[code://packages/computer/src/machinegit.ts#L336](../../packages/computer/src/machinegit.ts#L336) - a bring-back makes its scratch folder in `tmpdir()`"
  - git://4d64a4b40 - main when the problem was read
---

## Symptom

On 2026-11-22 on Softov's machine, `computer-git-fetch.test.ts` failed `answers nothing to bring back where the machine has committed nothing`.
It said `expected [ 'ahpd-bringback-kQpvFS' ] to deeply equal []`, at the check that no scratch folder is left.
The run was the computer suite on `test/git-runs-no-background-maintenance`, with real Docker.

## Cause

`leftOver` lists every `ahpd-bringback-*` folder in `tmpdir()`.
Since `tools/test-tmpdir.ts`, `tmpdir()` is one folder for the whole run, and the test files run in parallel.
Other files also bring work back, such as `computer-disposable.test.ts` and `computer-far-git.test.ts`, so their scratch folders can be there while the case checks.

## Impact

A full computer run fails at random where Docker is present, and a red run needs a second run before it says anything.

## Workaround

None. Running the suite again is not a fix.

## Fix

Give the case's runtime a temporary folder of its own, and read only that folder.
Or compare the folders after the bring-back with the folders before it, and name only a folder this case made.
