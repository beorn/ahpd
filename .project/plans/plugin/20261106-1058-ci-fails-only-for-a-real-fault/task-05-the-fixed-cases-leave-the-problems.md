---
title: The fixed cases leave the problem records
status: done
depends:
  - task-01-cofold-when-has-no-cap-of-its-own.md
  - task-02-servercheck-answers-docker-at-once.md
  - task-03-a-streamed-file-opens-before-its-body.md
  - task-04-the-steering-after-attachments-arrives.md
layer: "docs"
refs:
  - git://b0fb33f09 - the last commit that holds `problems/three-cases-fail-at-random-on-windows.md`, which held the cofold edit and server-check cases this task took out; the record went after #420
  - problems/two-attachment-cases-time-out-on-windows.md - holds the two attachment cases
  - problems/a-cofold-titling-case-times-out-on-windows.md - holds the cofold titling case
---

## Objective

Each problem record holds only the cases that are still open, and a record with no case left is deleted.

## Files

- `DELETE: .project/problems/a-cofold-titling-case-times-out-on-windows.md` - task 01 fixes its one case.
- `DELETE: .project/problems/two-attachment-cases-time-out-on-windows.md` - task 04 finds and fixes its cases.
- `UPDATE: .project/problems/three-cases-fail-at-random-on-windows.md` - the cofold edit case and the servercheck case go; the computer needs, disposable and options cases stay.

## Steps

1. Delete the titling record when task 01 is `done`.
2. Delete the attachment record when task 04 is `done`.
3. Remove the cofold edit case and the servercheck case from `three-cases-fail-at-random-on-windows.md`, in its `refs` and its table.
4. Change that record's title and text to match the cases it still holds.
5. Remove the links to the deleted records from the records that stay.
6. Run `lint-prose.mjs` on the record that stays.

## Validation

- `rg -n "a-cofold-titling-case|two-attachment-cases" .project/` finds only this plan.
- `lint-prose.mjs` passes on `three-cases-fail-at-random-on-windows.md`.

## Resume

The titling and attachment records are deleted. `three-cases-fail-at-random-on-windows.md` keeps its path and holds the two computer cases, with the title "Two computer cases fail at random on Windows". `.project/working/problems-report-20261111.md` and `.project/working/HANDOFF.md` still link the deleted records; they are dated snapshots and stay as written.

Later on 2026-11-21 the record went too. #420 fixed its disposable case. Its computer-needs case had failed once only, and the plan's answer gives such a case no record. That case now asserts its machine was made and found, so a repeat names its cause.
