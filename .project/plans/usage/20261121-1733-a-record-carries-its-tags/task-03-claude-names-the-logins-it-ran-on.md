---
title: A Claude turn names the logins it ran on
status: done
depends: [task-02-a-record-takes-the-tags-it-passed.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/logins.ts#L435-L465](../../../../packages/agent-claude/src/logins.ts#L435-L465) - `Login`, whose `id` is the connector id"
  - "[code://packages/agent-claude/src/logins.ts#L116](../../../../packages/agent-claude/src/logins.ts#L116) - `FAILOVER`, when a turn moves to the next login"
  - "[code://packages/agent-claude/src/session/query.ts#L1440-L1465](../../../../packages/agent-claude/src/session/query.ts#L1440-L1465) - the usage `_meta` of a finished turn"
  - "[code://packages/agent-claude/src/session/parts.ts#L142-L150](../../../../packages/agent-claude/src/session/parts.ts#L142-L150) - `sayUsage`, the usage sent while the turn runs"
---

## Objective

A Claude turn's usage `_meta` names, in `ahpd.connectors`, each login connector the turn ran on.
The record then carries those logins' tags through task 02.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts:142-150` - keep the turn's login ids and send them in `sayUsage`.
- `UPDATE: packages/agent-claude/src/session/query.ts:1440-1465` - add `ahpd.connectors` to the finished turn's `_meta`.
- `UPDATE: packages/agent-claude/test/agent-claude-usage.test.ts` - the login cases.

## Steps

1. Add the turn's login ids to the parts, cleared by `newTurn`.
2. Add `ctx.login.id` to the list when a turn starts on a login.
3. Add the next login's id when the turn fails over to it.
4. Send the list as `_meta['ahpd.connectors']` in `sayUsage` and in the finished turn's usage.
5. Send no `ahpd.connectors` when the turn ran on no login.
6. Add a test: a turn on one login names that login.
7. Add a test: a turn that failed over names both logins, in order.
8. Add a test: a turn with a pushed credential names no login.

## Validation

- The three cases of steps 6 to 8 are in `agent-claude-usage.test.ts`.
- `pnpm --filter @ahpd/agent-claude test` passes.
- By hand: tag `claude-login` with `main` and send one turn on agent `claude`.
- Read `tags` in the new line of `usage/2026-11-model.jsonl`. It holds `main`.

## Resume

Built 2026-11-21.
A run signs in with one login, so each usage names `ctx.login.id` through `withLogin` in `parts.ts`, and no list is kept per turn.
A failover is a new run, so it names the next login, and the meter and `mergeLogicalTurnUsage` join the two.
