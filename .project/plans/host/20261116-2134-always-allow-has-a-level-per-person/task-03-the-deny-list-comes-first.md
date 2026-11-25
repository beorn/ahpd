---
title: The deny list comes first
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L784-L788](../../../../packages/sdk/src/access/commandautoapprover.ts#L784-L788) - the order of the decisions"
  - "[code://packages/sdk/test/commandautoapprover.test.ts](../../../../packages/sdk/test/commandautoapprover.test.ts) - the approver's cases"
---

## Objective

A command that the terminal table denies, such as `find -exec`, is refused even when a permission rule allows it.

## Files

- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:784-788` - the table's deny rules are read before an allow from a permission rule.
- `UPDATE: packages/sdk/test/commandautoapprover.test.ts` - the order's cases.

## Steps

1. Read the table's deny rules and the line's deny for each part before the classifier's `allow`.
2. Keep the classifier's `ask` first, as it is.
3. Keep an allow from the classifier for a part that no deny rule names.

## Validation

- `commandautoapprover.test.ts`: with the rule `Shell(find *)` allowed, the approver refuses `find . -exec rm {} \;`.
- `commandautoapprover.test.ts`: with the same rule, the approver approves `find . -name x`.
- The sdk suite passes.

## Resume

Built on 2026-11-16, awaiting review.

- The case uses a classifier that allows `find`, in `commandautoapprover.test.ts`.
