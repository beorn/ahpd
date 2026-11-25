---
title: A person's restriction and answer stay their own
domain: host
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
requires:
  - plans/host/20261117-1047-approval-settings-are-kept-per-person/plan.md
refs:
  - git://b68891a47 - the last commit that holds the problems a-push-can-turn-off-the-auto-approval-restriction.md and a-client-names-its-own-answer-host-policy.md, which this plan fixes
  - "[code://packages/sdk/src/access/personrules.ts#L13](../../../../packages/sdk/src/access/personrules.ts#L13) - `APPROVAL_KEYS`, the root keys each person keeps their own value of"
  - "[code://packages/sdk/src/host/spawn.ts#L559-L652](../../../../packages/sdk/src/host/spawn.ts#L559-L652) - `personSettingsOf` and `setting`, and the two reads of `autoApprovePolicyRestricted` from the host's value"
  - "[code://packages/sdk/src/host/root.ts#L825](../../../../packages/sdk/src/host/root.ts#L825) - the schema mark `person`, set on every key of `APPROVAL_KEYS`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L158-L163](../../../../packages/sdk/src/vscoderootconfig.ts#L158-L163) - `autoApprovePolicyRestricted`, VS Code's key, `readOnly`"
  - "[code://packages/sdk/src/host/chatactions.ts#L2263-L2268](../../../../packages/sdk/src/host/chatactions.ts#L2263-L2268) - a client's answer passes its own decision source to `session.confirm`"
  - "[code://packages/sdk/src/vscode/agentpermissionresponsemeta.ts#L21-L32](../../../../packages/sdk/src/vscode/agentpermissionresponsemeta.ts#L21-L32) - `readAgentPermissionResponseMeta`, which takes `host_policy` from the client"
  - "[code://docs/server/USERS.md#L114](../../../../docs/server/USERS.md#L114) - *Whose approval settings apply*"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2830-L2846 - VS Code refuses a change to a read-only key from a relayed client only, so its window may push one
---

## Goal

On a host with users, the auto-approve restriction a person's window pushes holds in that person's sessions, and no other person's push lifts it.
A client's answer to a question is never recorded as the host's own policy.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- `autoApprovePolicyRestricted` is `readOnly` in VS Code's schema: a client draws no control for it, and the window pushes it from its policy.
- VS Code refuses a change to a read-only key only from a relayed client. Its own window may change one.
- Today one push of the key restricts or frees every session on the host, and any holder of `config:change` can push `false`.
- host/20261117-1047 keeps three window keys per person, through `APPROVAL_KEYS`, and a session reads its owner's value.

### Searches performed

- `rg "autoApprovePolicyRestricted" packages/sdk/src` - two reads in `spawn.ts`, both of the host's value.
- `rg "host_policy" packages/sdk/src` - the host's own answers in `spawn.ts`, and the client's in `chatactions.ts`.

### Gaps

- `autoApprovePolicyRestricted` is one value for the host.
- A client's `_meta` can name `host_policy` as the source of its own answer.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `autoApprovePolicyRestricted` is kept per person, as host/20261117-1047 keeps its three keys | Softov, 2026-11-18: "Per person, like #367's keys", in [decisions/the-auto-approve-restriction-is-kept-per-person.md](../../../decisions/the-auto-approve-restriction-is-kept-per-person.md) | 01 |
| A session reads its owner's value, and the host's where the owner keeps none | (defaulted: the rule of the three keys) | 01 |
| Every read of the key takes the owner's value: the two in `spawn.ts`, the Allow All refusal in `chatactions.ts`, and the policy a session starts with | (defaulted: one read left on the host's value lets another person's push lift the restriction there) | 01 |
| A host with no users is unchanged | (defaulted: the rule of the three keys) | 01 |
| `readOnly` stays on the key, as VS Code's schema has it | (defaulted: a client reads the schema VS Code sends) | 01 |
| A client's answer that names `host_policy` is passed to the backend with no decision source | (defaulted: the problem's one fix) | 02 |

## Proposed architecture

- **Data flow** - a push of `autoApprovePolicyRestricted` goes to the pusher's file, as the three keys do. `spawn.ts` reads it with `setting`.
- **Layer responsibilities** - sdk: `personrules.ts`, `spawn.ts`, `chatactions.ts` · docs: `USERS.md`, the notes.
- **Source-of-truth files** - [`code://packages/sdk/src/access/personrules.ts`](../../../../packages/sdk/src/access/personrules.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the restriction is a person's own](task-01-the-restriction-is-a-persons-own.md) | done | - |
| [02 - an answer is never the host's policy](task-02-an-answer-is-never-the-hosts-policy.md) | done | - |

## Risks and tradeoffs

- A person can lift their own restriction from another client - as in VS Code, a policy reaches only the windows it governs.
- A value an admin pushed before the update stays the host's - it holds in sessions whose owner keeps none, as the three keys' values do.

## Resume state

- **Done so far:** tasks 01 and 02. Beyond task 01, the Allow All refusal in `chatactions.ts` and the policy a session starts with also read the owner's value, through `approvalSetting`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** `readOnly` means a settings page draws no control, not that no push writes it.

## Final verification checklist

- [ ] On the test daemon, alice pushes `autoApprovePolicyRestricted: true`, and her `autoApprove` session asks.
- [ ] carol then pushes `false`, and alice's session still asks, while carol's own `autoApprove` session runs.
- [ ] A client's answer with `host_policy` in its `_meta` reaches the backend with no decision source.
- [ ] The sdk and computer suites pass, one at a time, and `check` and `check-windows` are green.
