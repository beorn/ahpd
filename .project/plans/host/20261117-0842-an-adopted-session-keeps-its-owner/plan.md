---
title: An adopted session is kept with its owner
domain: host
status: built
priority: high
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - git://3a6fdcff8 - the last commit that holds `problems/a-claude-session-from-vs-code-has-no-owner.md`, with the proof of 2026-11-17
  - "[code://packages/sdk/src/host/lifecycle.ts#L2200-L2207](../../../../packages/sdk/src/host/lifecycle.ts#L2200-L2207) - `who`, the owner of the connection that sent the turn"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2258-L2261](../../../../packages/sdk/src/host/lifecycle.ts#L2258-L2261) - a person's turn adopts an external session, and writes no owner"
  - "[code://packages/sdk/src/host/lifecycle.ts#L2618-L2624](../../../../packages/sdk/src/host/lifecycle.ts#L2618-L2624) - `openSession` writes the owner and keeps its principal, the pattern to copy"
  - "[code://packages/sdk/src/host/catalogue.ts#L1838-L1849](../../../../packages/sdk/src/host/catalogue.ts#L1838-L1849) - `adoptExternalSession`, which announces the session as this host's own"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L2111-L2135](../../../../packages/sdk/test/host-catalogue.test.ts#L2111-L2135) - the adoption case, the pattern of the new one"
  - "[code://docs/sdk/SESSIONS.md#L100](../../../../docs/sdk/SESSIONS.md#L100) - the docs on an external session and its adoption"
---

## Goal

On a host with users, a person's turn that adopts a session makes that person its owner.
A session they make with `createSession` gets its owner the same way.
An owner check, such as a turn getting the session's approvals, then works in a session taken over from the host's own CLI.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The proof is in the problem file at `git://3a6fdcff8`.
A test in `/github/ahpd.worktrees/external-owner` signs ana in, makes a session and adopts an external one.
The made session has the owner `user:ana`, and the adopted one has none.

### Searches performed

- `rg "setOwner" packages/sdk/src/host` - `openSession` and a chat move write an owner; adoption does not.
- `rg "adoptExternalSession" packages/sdk/src` - one caller, the turn start in `lifecycle.ts`.

### Runtime path

```
chat/turnStarted from a person -> lifecycle: who = ownerFor(sender)
  -> external and no owner: kept.setOwner(id, who), principal kept
  -> adoptExternalSession -> announced with ahpd.owner
```

### Gaps

- Adoption writes no owner, so every owner check fails in an adopted session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An adopted session is kept with the owner of the person whose turn adopts it | Softov, 2026-11-17: "plan it", on that proposal | 01 |
| The owner is written only when the session has none | (defaulted: an owner is never moved by a turn) | 01 |
| The owner is written before the adoption is announced, so the announced session carries `ahpd.owner` | (defaulted: a client reads the owner off the announcement) | 01 |
| A host with no users writes no owner, as `createSession` writes none there | [code://packages/sdk/src/host/lifecycle.ts#L2620](../../../../packages/sdk/src/host/lifecycle.ts#L2620) | 01 |
| The scope is not written at adoption: the adopter's turn charges it, as a session with no scope is charged | (defaulted: the scope follows the turn that runs) | - |

## Proposed architecture

- **Data flow** - the turn start writes `who` as the session's owner before it calls `adoptExternalSession`, and keeps the sender's principal as `openSession` does.
- **Layer responsibilities** - sdk: `lifecycle.ts` · docs: one sentence in `docs/sdk/SESSIONS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - adoption writes the owner](task-01-adoption-writes-the-owner.md) | done | - |

## Risks and tradeoffs

- This path is not proven for the five ownerless records of 2026-10-20, which are gone - a new sighting gets a problem file.
- A session adopted before this change keeps no owner - nothing writes it back, and the next adoption cannot happen, since it is no longer external.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** task 01 is `implemented` on 2026-11-17, on the branch `host/20261117-0842-an-adopted-session-keeps-its-owner`.
- **Next action:** Softov's review, then the check of *Final verification checklist* on the test daemon.
- **Open questions:** none.
- **Watch out for:** an sdk host change runs the computer suite too, as HANDOFF *Tests* says.

## Final verification checklist

- [x] On the test daemon with users, a turn on an external Claude session writes the sender as its owner in `sessions/<id>.json`.
- [x] The sdk and computer suites pass.
