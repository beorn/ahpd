---
title: A connector is an instance
status: todo
depends: 
  - task-02-the-channel-serves-each-instance.md
layer: "sdk"
---

## Objective

A test plugin adds each of its adapter's connectors as an instance, so the Desk case works end to end.

## Files

- `CREATE: packages/sdk/test/list-connector-instances.test.ts` - an adapter whose `open` adds an instance and whose close removes it.
- `UPDATE: docs/plugins/PLUGINS.md` - the section "A list of your own".

## Steps

1. Write a fixture plugin with an adapter and a kind on an instance list.
2. Add an instance in `open`, with the connector's id, title and owner.
3. Remove it in the close that `open` answers.
4. Show the pattern in the docs.

## Validation

- Make a connector, then remove it: the kind adds one instance, then removes it.
- The list's subscribers get an action for each change.

## Resume
