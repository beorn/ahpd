---
title: globalAutoApproveEnabled keeps VS Code's meaning
status: accepted
date: 2026-11-18
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L545](../../packages/sdk/src/host/spawn.ts#L545) - `globalAutoApprove` is read into every question"
  - git://7e16a8a05 - the host decides a question with VS Code's chain
  - git://4bdee3ea1 - the last commit that holds the problem global-auto-approve-approves-every-tool-call.md
---

## Context

`globalAutoApproveEnabled` is a root config key that VS Code's host declares.
With it on, the host approves every tool question with no person asked, as VS Code's host does.
A client that holds `config:change` can set it, and only `admin` holds that grant.
The security review of 2026-11-08 found that at `e388d12f5` the key only skipped the trust question.
Since host/20261116-2126, the key is one of the session's approvals.
So it applies to the owner's own turns and to turns that nobody sent, and not to another person's turn.

## Decision

`globalAutoApproveEnabled` keeps VS Code's meaning in 0.15.0: on, it approves every tool question in a turn that gets the session's approvals.
A client with `config:change` may set it.

## Consequences

- A VS Code window behaves on ahpd as on VS Code's own host.
- An admin's window can remove the questions in every session's own turns. The operator gives `admin` only to people trusted with that.
- No daemon option and no second key is added.

## Options

- A daemon option that no client push can set lost. A VS Code window that sets the key would see it refused, and only an admin can take the risk.
- A separate host-wide key lost: two keys with close meanings, for the same reason.
