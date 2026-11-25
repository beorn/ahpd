---
title: A session's approvals follow its owner
domain: host
status: built
priority: high
created: 2026-11-16
revalidated: 2026-11-16
refs:
  - git://37affa5dc - the last commit that holds `problems/auto-approval-and-trust-ignore-who-sent-the-turn.md`, with its reproduction of 2026-11-16
  - git://e388d12f5 - `getAutoApproval` and `trustedBy` answered only the session's owner, the check this plan brings back
  - "[code://packages/sdk/src/host/spawn.ts#L520-L640](../../../../packages/sdk/src/host/spawn.ts#L520-L640) - `toolReady`, which reads every approval for every question, whoever sent the turn"
  - "[code://packages/sdk/src/host/spawn.ts#L1248-L1255](../../../../packages/sdk/src/host/spawn.ts#L1248-L1255) - `trustedBy`, which reads `workspaceTrust` for every start"
  - "[code://packages/sdk/src/host/spawn.ts#L462](../../../../packages/sdk/src/host/spawn.ts#L462) - `kept.sender`, the person who sent a turn, kept with the session"
  - "[code://packages/sdk/src/types/host.ts#L1013](../../../../packages/sdk/src/types/host.ts#L1013) - `eligibleForAutoApproval`, a file-only security setting, the shape the new one copies"
  - "[code://packages/server/src/commands/options.ts#L560](../../../../packages/server/src/commands/options.ts#L560) - where a file-only setting is declared"
  - "[code://packages/server/src/commands/run.ts#L1563](../../../../packages/server/src/commands/run.ts#L1563) - where the daemon hands it to `createHost`"
  - "[code://docs/server/CONFIGURE.md#L123](../../../../docs/server/CONFIGURE.md#L123) - the setting's row beside `eligibleForAutoApproval`"
  - "[code://packages/sdk/test/host-permissions.test.ts](../../../../packages/sdk/test/host-permissions.test.ts) - the question cases the new ones sit beside"
  - "[code://packages/sdk/test/host-trust.test.ts](../../../../packages/sdk/test/host-trust.test.ts) - the trust cases"
---

## Goal

On a host with users, a person's turn gets a session's approvals only when that person owns the session.
The approvals are the terminal rules, the edit patterns, the allow rules, the reads inside the working folders, `globalAutoApproveEnabled`, the session's `autoApprove` and `workspaceTrust`.
A turn nobody sent gets the owner's approvals while `unattendedAutoApprove` is on, the default, and none while it is off.
A host with no users file is unchanged.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The reproduction is in the problem file at `git://37affa5dc`: dave, with `chat:send` and no `chat:answer`, ran `rm` in alice's `autoApprove` session with no question.

### Searches performed

- `git show e388d12f5:packages/sdk/src/host/spawn.ts` - `getAutoApproval` and `trustedBy` compared `ctx.ownerFor(sender)` with `kept.owner(idOf(uri))` when `options.users` was set.
- `rg "senderOf|kept.sender" packages/sdk/src/host/spawn.ts` - the host keeps each turn's sender, live and in the session's record.
- `rg "trustedBy" packages/sdk/src/host/spawn.ts` - trust is read once per start, for the folders the backend is handed.

### Runtime path

```
chat/toolCallReady -> toolReady -> the turn's sender (senderOf, kept.sender) and the session's owner
  -> the sender owns it, or nobody sent it and unattendedAutoApprove is on -> every approval, as today
  -> otherwise -> no approval: deny rules, managed rules and the operator's always-ask still hold
start -> trustedBy -> the start's sender, by the same rule -> workspaceTrust, or no trust
```

### Gaps

- `toolReady` and `trustedBy` read no sender.
- No setting names a start that nobody sent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| On a host with users, a person's turn gets the approvals only from the session's owner, as at `e388d12f5` | Softov, 2026-11-08, in the problem file | 01 |
| A turn nobody sent gets the owner's approvals by setting | Softov, 2026-11-08, in the problem file | 02 |
| The setting is on by default, so an automation, a bot wake and a resumed turn keep today's approvals | Softov, 2026-11-16: "Owner's approvals, on" | 02 |
| The setting is `unattendedAutoApprove` | Softov, 2026-11-16: "unattendedAutoApprove" | 02 |
| The setting is in `config.json` only, and no client can push it | (defaulted: a security setting, as `eligibleForAutoApproval` is file-only) | 02 |
| A turn with no approval still meets the deny rules, the managed rules and the operator's always-ask | (defaulted: a deny is no approval, and dropping it would widen what the turn may do) | 01 |
| A turn whose sender the session's record keeps counts as that person's, also after a restart | (defaulted: the record says who sent it, and `kept.sender` is what the host reads today) | 01 |
| A turn is a person's when its message comes from `user`; any other kind is unattended | (defaulted: an automation's turn carries its owner as sender, so only the origin tells the two apart) | 01 |
| A host with no users file is unchanged | (defaulted: at `e388d12f5` the check ran only with `options.users`) | 01 |

## Proposed architecture

- **Data flow** - `toolReady` reads the turn's sender and the session's owner, and builds the approval with or without the approvals. `trustedBy` reads the start's sender the same way.
- **State flow** - No new state. `unattendedAutoApprove` is a daemon option on `HostOptions`.
- **Layer responsibilities** - sdk `host/spawn.ts`: whose turn it is, and what it gets · server `commands/options.ts` and `run.ts`: the setting · docs: the setting and the rule.
- **Source-of-truth files** - [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the owner's turns get the approvals](task-01-the-owners-turns-get-the-approvals.md) | done | - |
| [02 - a setting for turns nobody sent](task-02-a-setting-for-turns-nobody-sent.md) | done | 01 |
| [03 - the docs say whose turns are approved](task-03-the-docs-say-whose-turns-are-approved.md) | done | 01, 02 |

## Risks and tradeoffs

- Each asked call in another person's turn now asks - that is the fix, and a role with `chat:answer` may answer it.
- An injected prompt in an automation still runs approved commands by default - the operator turns `unattendedAutoApprove` off.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 to 03 built on 2026-11-16 on branch `host/20261116-2126-approvals-follow-the-sessions-owner`, awaiting review.
- **Next action:** Softov reviews the PR, then the checks of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** a host with no users file has no owner to compare; leave it as it is today.

## Final verification checklist

- [x] The sdk suite and the computer suite pass, one at a time.
- [x] On the test daemon, dave's `rm` in alice's `autoApprove` session asks, and alice's own does not.
- [x] With `unattendedAutoApprove` off, an automation's `pnpm ls` asks; with it on, it runs.
