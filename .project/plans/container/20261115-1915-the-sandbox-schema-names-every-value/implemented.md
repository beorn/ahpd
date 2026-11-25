---
title: The sandbox schema names every value - implemented
date: 2026-11-18
refs:
  - git://74a5d756a - the merge of #348
---

The computer plugin page shows five warnings at each start, one for each object in the root `sandbox` setting that names no value.
A client draws such an object as "No parameters defined.", and a save there can destroy what was written.
After this plan, the schema names every value, the warnings go, and a test fails when a provider configuration has a gap again.

## What was built

- [01 - The sandbox schema names every value](task-01-the-schema-names-every-value.md).
- [02 - The gap test walks each root config property a plugin declares](task-02-the-gap-test-walks-root-config.md).

## Verified

- CI on #348 passed every check, Windows included, and it merged as `74a5d756a`.
- Each task file says what its cases check.

## Departures from the plan

- The build was in another session. Its check of the report waits on Softov reimporting the computer plugin.

## Left for later

- The check by hand that the computer plugin shows no sandbox schema warning, in [pending/container-sandbox-schema-checks.md](../../../pending/container-sandbox-schema-checks.md).
