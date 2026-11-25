---
title: Always Allow has a level for one person
domain: host
status: built
priority: high
created: 2026-11-16
revalidated: 2026-11-16
refs:
  - git://8c790f5bd - the last commit that holds `problems/always-allow-writes-host-rules-without-config-change.md`, with its reproduction of 2026-11-16
  - "[code://packages/sdk/src/access/permissionrules.ts#L17-L30](../../../../packages/sdk/src/access/permissionrules.ts#L17-L30) - `PermissionGrantScope` and the option ids of a grant"
  - "[code://packages/sdk/src/host/permissions.ts#L529](../../../../packages/sdk/src/host/permissions.ts#L529) - `grantOption`, one option of a grant"
  - "[code://packages/sdk/src/host/permissions.ts#L635](../../../../packages/sdk/src/host/permissions.ts#L635) - `confirmationOptions`, the options a question offers"
  - "[code://packages/sdk/src/host/chatactions.ts#L2273-L2290](../../../../packages/sdk/src/host/chatactions.ts#L2273-L2290) - an answer writes a host grant into the root's `permissions`, a session grant into the session's"
  - "[code://packages/sdk/src/host/spawn.ts#L572](../../../../packages/sdk/src/host/spawn.ts#L572) - a question reads the session's rules, then the host's"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L784-L788](../../../../packages/sdk/src/access/commandautoapprover.ts#L784-L788) - a permission rule's allow settles a command before the table's deny rules"
  - "[code://packages/sdk/src/access/users.ts#L178-L183](../../../../packages/sdk/src/access/users.ts#L178-L183) - the `config` subject's operations, where `permissions` goes"
  - "[code://packages/sdk/src/host/gate.ts#L313-L319](../../../../packages/sdk/src/host/gate.ts#L313-L319) - a push of `workspaceTrust` alone needs `trust:push`, the pattern for `permissions`"
  - "[code://packages/sdk/src/host/spawn.ts#L579](../../../../packages/sdk/src/host/spawn.ts#L579) - `autoApprovePolicyRestricted` and the session's `autoApprove`"
  - "[code://docs/server/REMOTE.md#L87](../../../../docs/server/REMOTE.md#L87) - the docs name `config:write` where the code checks `config:change`"
  - "[code://.project/plans/host/20261116-2134-always-allow-has-a-level-per-person/mockup.html](mockup.html) - the mockup Softov approved on 2026-11-16"
---

## Goal

On a host with users, a person's "Always Allow" answer holds for that person, not for every session on the host.
A person with the new grant `config:permissions` may still write the host's rules, under a label that says they apply to everyone.
The terminal table's deny list wins over any allow rule again.
An option allows every command for the rest of one session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The reproduction is in the problem file at `git://8c790f5bd`.
bob, a member, answered Always Allow `rm …`, and `rm` then ran with no question in alice's session.

### Searches performed

- `rg "PermissionGrantScope" packages/sdk/src` - two scopes, `session` and `host`, in the option id's prefix.
- `rg "perPerson|people/" packages/sdk/src` - no store keeps a value per person; this plan makes the first.
- `rg "config:write" docs` - `REMOTE.md` and `RUN.md` name a grant that the code calls `config:change`.

### Runtime path

```
question -> confirmationOptions: session level; person level on a host with users; host level when the owner holds config:permissions; Allow All Commands unless restricted
answer -> chatactions: session -> session's permissions; person -> the answerer's store; host -> root permissions, checked again for config:permissions
next question -> rules of the session, then the session owner's person rules, then the host's -> the table's deny list before any allow
```

### Gaps

- A grant has no person scope, and no store keeps a person's rules.
- Any answer may write the host's rules, and no grant guards a push of `permissions`.
- An allow rule wins over the table's deny list.
- No option sets the session's `autoApprove`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| "Always Allow" splits into the person's level and the host's level | Softov, 2026-11-08: "Always Allow Command in User" | 01, 04 |
| A new grant `config:permissions` writes the host's rules, and `admin` holds it | Softov, 2026-11-08 | 02 |
| A host grant from a person without `config:permissions` stays in the session | Softov, 2026-11-08 | 02 |
| The table's deny list comes before an allow rule, as at `e388d12f5` | Softov, 2026-11-08 | 03 |
| "Allow All Commands in this Session" sets the session's `autoApprove`, refused where `autoApprovePolicyRestricted` is set | Softov, 2026-11-08 | 04 |
| A Workspace level is later, in a brief of its own | Softov, 2026-11-08 | - |
| File and URL grants get the same levels | (defaulted: they share `grantOption`) | 01, 04 |
| The mockup is approved as drawn | Softov, 2026-11-16: "Approve the design" | 04 |
| The person's level reads "… for Me" | Softov, 2026-11-16: "… for Me" | 04 |
| The host's level reads "… for Everyone" on a host with users | Softov, 2026-11-16: "… for Everyone" | 04 |
| A host with no users file keeps VS Code's labels and offers no person level | Softov, 2026-11-16: "Host level only, as VS Code" | 04 |
| A question reads the session's rules, then the session owner's person rules, then the host's | Softov, 2026-11-08, in the problem file | 01 |
| "for Me" writes the rules of the person who answers | (defaulted: the label says "Me", and that person is who chose it) | 01 |
| A person's rules are a file per person in the config folder, `permissions/<person>.json` | (defaulted: "a store of their own", from the problem file; no per-person store exists to reuse) | 01 |
| `permissions` is an operation of the `config` subject in its `write` group | (defaulted: as `change` is, so a role with `config:write` holds it) | 02 |
| The docs name `config:change` where they say `config:write` for the root config | Softov, 2026-11-08, in the problem file | 05 |
| A command the table denies is offered no grant | Softov, 2026-11-16: "No grant for it" | 04 |
| A push that names `permissions` beside other keys needs `config:permissions` too | (defaulted: one grant alone would let a role with `config:change` write the rules) | 02 |
| Only a `user:` owner has a person store | (defaulted: the host's own owner holds every grant) | 01 |
| Allow All is on shell questions only, is hidden under the managed lock, and needs `session:configure` | (defaulted: its label says commands, the lock takes Allow All away, and it changes the session's config) | 04 |

## Proposed architecture

- **Data flow** - A person grant goes to `permissions/<person>.json`; a question reads it for the session's owner between the session's rules and the host's.
- **Event flow** - A host grant still sends `root/configChanged`; a person grant sends nothing to other clients.
- **State flow** - The person store is new, read at each question, written at each person grant.
- **Layer responsibilities** - sdk `access`: the scope, the grant, the deny order · sdk `host`: the options, the answer, the reading · server: the store's folder · docs.
- **Source-of-truth files** - [`code://packages/sdk/src/access/permissionrules.ts`](../../../../packages/sdk/src/access/permissionrules.ts), [`code://packages/sdk/src/host/permissions.ts`](../../../../packages/sdk/src/host/permissions.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a person keeps rules of their own](task-01-a-person-keeps-rules-of-their-own.md) | done | - |
| [02 - the host's rules need config:permissions](task-02-the-hosts-rules-need-config-permissions.md) | done | 01 |
| [03 - the deny list comes first](task-03-the-deny-list-comes-first.md) | done | - |
| [04 - the question offers the approved levels](task-04-the-question-offers-the-approved-levels.md) | done | 01, 02 |
| [05 - the docs name the levels and the grant](task-05-the-docs-name-the-levels-and-the-grant.md) | done | 02, 04 |

## Risks and tradeoffs

- A host grant made before this plan stays in the host's `permissions` - the notes tell an admin to read the list once.
- A client that knows only VS Code's two scopes draws the person options as more grants - their labels say what they do.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 to 05 built on 2026-11-16 on branch `host/20261116-2134-always-allow-has-a-level-per-person`, from the branch of host/20261116-2128, awaiting review.
- **Next action:** Softov reviews the PR, then the checks of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** compare each label with the approved mockup before the PR. A host with no users file keeps today's options, and gains Allow All.

## Final verification checklist

- [x] The sdk suite and the computer suite pass, one at a time.
- [x] On the test daemon, bob's "for Me" answer leaves alice's `make` asking, and alice's "for Everyone" answer approves it in bob's session. The table denies `rm`, so `rm` asks for both.
- [x] A member's push of `permissions` is refused.
- [x] Each label matches the approved mockup.
