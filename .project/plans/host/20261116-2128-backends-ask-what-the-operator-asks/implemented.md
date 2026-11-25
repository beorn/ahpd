---
title: Each backend asks what the operator says to ask - implemented
date: 2026-11-18
refs:
  - git://64639616d - the merge of #361
---

A tool the operator sets `false` in `eligibleForAutoApproval` asks every time, in every backend and every mode, under `managedRules: checked`.
Today a Claude host tool with `confirm: false` runs with no question.
pi and cofold settle a call in some modes before the host sees it.
Under `managedRules: handed` nothing changes: the host hands the rule to the runtimes, as VS Code does.

## What was built

- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `alwaysAsks?(toolName: string, contributor?: unknown): boolean` on `Start`, with its doc comment.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the host sets it from `alwaysAsks` under `checked`.
- [`code://packages/sdk/test/host-permissions.test.ts`](../../../../packages/sdk/test/host-permissions.test.ts) - the field's cases.
- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - the shortcut reads `start.alwaysAsks` first.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts) - the context carries the start's check.
- [`code://packages/agent-claude/test/agent-claude-questions.test.ts`](../../../../packages/agent-claude/test/agent-claude-questions.test.ts) - the cases.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `decide` reads `start.alwaysAsks` before the mode.
- [`code://packages/agent-cofold/src/turnagent.ts`](../../../../packages/agent-cofold/src/turnagent.ts) - the call's decision reads `start.alwaysAsks` first.
- [`code://packages/agent-pi/test/agent-pi-asking.test.ts`](../../../../packages/agent-pi/test/agent-pi-asking.test.ts) - pi's cases.
- [`code://packages/agent-cofold/test/agent-cofold-questions.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-questions.test.ts) - cofold's cases.
- [`code://docs/server/CONFIGURE.md`](../../../../docs/server/CONFIGURE.md) - the two rows.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - `Start.alwaysAsks`, beside the other fields of `Start`.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one item under a heading of 0.15.0.

## Verified

- The sdk, computer, agent-claude, agent-pi and agent-cofold suites pass, one at a time.
- On the test daemon, `mcp__host__list_bash` set `false` asks in a Claude session.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #361.

## Departures from the plan

- `Start.alwaysAsks` reads the bound tools of the session's default chat at each call.
- One case in `host-permissions.test.ts` covers both values of `managedRules`.
- The cases are in `host-tool-confirm.test.ts`, where the `confirm: false` cases already are, not in `agent-claude-questions.test.ts`.
- The case uses `mcp__host__post_message`, the tool that file already binds.
- The check reads the call's name alone, with no contributor, since the CLI names a host tool by its server.
- In pi, a mode that refuses the call still refuses it. `plan` refuses a write that the rule names, and does not ask about it.
- cofold's policy cannot ask past an approval it remembers, so the check is in `beforeTool`. It answers `approval`, or a refusal in `dontAsk`.
- cofold reads its remembered approval at `approvals/<session>/<tool>`. The hook deletes that key for a tool the rule names.
- ahpd never sends cofold `alwaysApprove`, so only a store another program shares holds such a key.
- The cofold case seeds the key in a memory store. The case fails when the delete is removed.
- The note item is under *Upgrading* of 0.15.0.

## Left for later

- Nothing.
