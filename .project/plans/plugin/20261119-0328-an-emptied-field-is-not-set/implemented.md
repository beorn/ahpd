---
title: An emptied field is not set - implemented
date: 2026-11-19
refs:
  - git://05fa09ecf
  - "[code://packages/sdk/src/kinds/operations.ts](../../../../packages/sdk/src/kinds/operations.ts)"
---

An optional field that a person empties in a create or an edit form is left out of the operation's input, so the field ends up not set. A tunnel's Person emptied in ahpw no longer refuses the edit.

## What was built

- [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts) - `withoutEmptied` leaves out each top-level field that is `""`, not required, not `secret`, and whose schema refuses `""`. `inputOf` calls it before the check.
- [`code://packages/sdk/test/kinds-operations.test.ts`](../../../../packages/sdk/test/kinds-operations.test.ts) - four cases: an emptied field dropped, a required field refused, a field that takes `""` kept, and a blank secret kept.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - a line under *Plugins* of 0.15.0.

## Verified

- The sdk suite passed 4956 cases, the server suite 1982 and the computer suite 633, one at a time.
- The case of an emptied field fails with the drop taken out.
- #384 passed `check` and `check-windows` on its first run, and merged as `05fa09ecf` on 2026-11-19.

## Departures from the plan

- A field marked `secret` keeps its `""`. The sdk suite showed that a blank secret means the stored one stays. A drop there would erase the secret. The plan's *Answers* holds the row.

## Checked by hand

- Softov emptied a tunnel's Person in ahpw and saved it on 2026-11-19, and it worked.
