---
title: The approval settings are kept per person
domain: host
status: built
priority: high
created: 2026-11-17
revalidated: 2026-11-17
requires:
  - plans/host/20261117-0842-an-adopted-session-keeps-its-owner/plan.md
refs:
  - git://a13eea807 - the last commit that holds `problems/an-admins-pushed-terminal-rule-applies-to-every-session.md`, with its reproduction of 2026-11-16
  - "[code://packages/sdk/src/host/actions.ts#L328-L420](../../../../packages/sdk/src/host/actions.ts#L328-L420) - a push on the root, applied and kept as one value for the whole host"
  - "[code://packages/sdk/src/host/gate.ts#L324-L334](../../../../packages/sdk/src/host/gate.ts#L324-L334) - `dispatchNeeds`: a push needs `config:change` unless it names only `workspaceTrust` or `permissions`"
  - "[code://packages/sdk/src/host/spawn.ts#L594-L629](../../../../packages/sdk/src/host/spawn.ts#L594-L629) - a question reads the terminal rules, the edit patterns and `terminalAutoApproveEnabled` from the root"
  - "[code://packages/sdk/src/host/spawn.ts#L553-L556](../../../../packages/sdk/src/host/spawn.ts#L553-L556) - `personRulesOf`, the read of the session owner's own rules"
  - "[code://packages/sdk/src/access/personrules.ts](../../../../packages/sdk/src/access/personrules.ts) - the person store, a file per person, which this plan extends"
  - "[code://docs/server/CONFIGURE.md#L150](../../../../docs/server/CONFIGURE.md#L150) - *Terminal rules* says the pushed rules are one value for the whole host"
  - "[code://docs/server/USERS.md#L96](../../../../docs/server/USERS.md#L96) - *Who an Always Allow is for*, the section the new one sits beside"
  - https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55 - VS Code's host keeps one root config, because it has one person
---

## Goal

On a host with users, the settings that decide what runs or is written without a question are kept per person.
A push from a person's window changes their own sessions, and no other person's.
A member's window applies its settings to their own sessions too.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The reproduction is in the problem file at `git://a13eea807`.
carol, an admin, pushed `{"rm": true}` as `terminalAutoApproveRules`, and `rm scratch.txt` then ran with no question in alice's session.

### Searches performed

- `rg "terminalAutoApproveRules|editAutoApprovePatterns|terminalAutoApproveEnabled" packages/sdk/src/host` - one read each, in `spawn.ts`, from `ctx.rootConfig`.
- `rg "personRules" packages/sdk/src/host` - the person store is read for `permissions` and written by an answer \"for Me\".

### Runtime path

```
push root/configChanged from a person -> gate: the approval keys need a sign-in, a new regex key needs config:change
  -> actions: the approval keys go to the pusher's file in the person store; the rest to the root as today
question in a session -> spawn: the owner's approval settings where they have one, else the root's
```

### Gaps

- A push of the approval keys sets the host's value for everybody.
- A member's push is refused, so a member's window settings never apply.
- A question reads the root's value whoever owns the session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `terminalAutoApproveRules`, `terminalAutoApproveEnabled` and `editAutoApprovePatterns` are kept per person | Softov, 2026-11-17: "All three approval keys" | 01 |
| Every person's push of them is their own, an admin's included; the host's value is not changed by a person's push | Softov, 2026-11-17: "Their own, like anyone's" | 01 |
| A push of only these keys needs a sign-in; a `/.../` key that VS Code's default table lacks needs `config:change` | Softov, 2026-11-17: "Yes, for their own" | 01 |
| `workspaceTrust` stays one host value | Softov, 2026-11-17, in the question: it has [a-folder-is-trusted-per-person-or-team.md](../../../briefs/a-folder-is-trusted-per-person-or-team.md) | - |
| The person store keeps the three keys beside `permissions` in `<person>.json` | (defaulted: one file per person, as host/20261116-2134 made it) | 01 |
| A person's value replaces the host's for that key in the sessions they own | (defaulted: a push replaces the value today, and VS Code pushes the whole table) | 02 |
| A session with no owner, or a `root:` owner, reads the host's value | (defaulted: nobody's settings apply to it) | 02 |
| A push of `null` for a key clears the person's value, so the host's applies again | (defaulted: a push of `null` clears a root key today) | 01 |
| A push from a root connection, and any push on a host with no users, sets the host's value as today | (defaulted: one person, as VS Code) | 01 |
| The root's state keeps the host's value, and each person's connection reads their own values in its place | Softov, 2026-11-17: "we replace the ones that are user facing" | 04 |
| The person keys are marked `x-ahpd-scope: "person"` in the schema a person's connection reads | Softov, 2026-11-17: "In this build" | 04 |
| A person's push of only the approval keys gets no echo on the root | (defaulted: an echo through `dispatch` would reduce their values into everybody's root) | 04 |
| A `replace` push still needs `config:change` | (defaulted: it clears the host's keys) | 01 |

## Proposed architecture

- **Data flow** - the push splits the approval keys from the rest. On a host with users, from a person, those keys go to `personRules.keep(person, values)`, and the rest go to the root.
- **State flow** - `<config>/permissions/<person>.json` holds `permissions` and the three keys. Nothing new is held in memory.
- **Layer responsibilities** - sdk: `personrules.ts`, `gate.ts`, `actions.ts`, `spawn.ts` · docs: `CONFIGURE.md`, `USERS.md`, `HOST.md`, `v0_15.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/access/personrules.ts`](../../../../packages/sdk/src/access/personrules.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a push keeps the approval keys for its person](task-01-a-push-keeps-the-keys-for-its-person.md) | done | - |
| [02 - a question reads the owner's settings](task-02-a-question-reads-the-owners-settings.md) | done | 01 |
| [03 - the docs say whose settings apply](task-03-the-docs-say-whose-settings-apply.md) | done | 02 |
| [04 - a person reads their own settings back](task-04-a-person-reads-their-own-settings.md) | done | 01 |

## Risks and tradeoffs

- On a host with users, no window sets the host's approval settings - the docs say so, and the stored root value stays the host's.
- A value an admin pushed before this change stays the host's - the 0.15 notes say to read it once.
- A person's other windows read a push of theirs only at their next connect - the pushing window keeps its own values.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 to 04 are `implemented` on 2026-11-17, on the branch `host/20261117-1047-approval-settings-are-kept-per-person`. Task 04 is Softov's idea of 2026-11-17, added during the build.
- **Next action:** Softov's review, then the checks of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** an sdk host change runs the computer suite too, as HANDOFF *Tests* says. `host-permissions.test.ts` and `users-gate-dispatch.test.ts` hold the cases of host/20261116-2134 to extend.

## Final verification checklist

- [x] On the test daemon, carol pushes `{"rm": true}`, and `rm` still asks in alice's session.
- [x] The same push makes `rm` run with no question in carol's own session.
- [x] bob, a member, pushes rules, and they apply in bob's sessions.
- [x] The sdk, computer and server suites pass.
