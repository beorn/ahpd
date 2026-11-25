---
title: The docs say how a wrapper is read
status: done
depends: [task-01-the-approver-reads-through-a-wrapper.md]
layer: "docs"
refs:
  - "[code://docs/server/CONFIGURE.md#L146](../../../../docs/server/CONFIGURE.md#L146) - *Terminal rules*"
  - "[code://docs/updates/v0_15.md#L20](../../../../docs/updates/v0_15.md#L20) - the 0.15 *Upgrading* list"
---

## Objective

*Terminal rules* says that a rule matches the command a wrapper runs.
The 0.15 notes say what a saved rule on a wrapper now approves.

## Files

- `UPDATE: docs/server/CONFIGURE.md:146-152` - one paragraph on wrappers in *Terminal rules*.
- `UPDATE: docs/updates/v0_15.md:20` - one *Upgrading* item.

## Steps

1. Add a paragraph to *Terminal rules* that lists the wrappers, and says the rules match the command each one runs.
2. Say in the same paragraph that no grant names a wrapper.
3. Add an *Upgrading* item: a saved rule on a wrapper, such as `Shell(command *)`, no longer approves the next command.

## Validation

- Read both files for an em dash or a hard wrap, since the docs keep their own style.

## Resume

Built on 2026-11-17: one paragraph in *Terminal rules*, and one *Upgrading* item before the Allow All item.
