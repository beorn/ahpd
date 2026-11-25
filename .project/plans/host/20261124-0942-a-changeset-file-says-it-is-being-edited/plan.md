---
title: A changeset file says it is being edited
domain: host
status: active
priority: high
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md
refs:
  - git://a3118737e - the brief `briefs/the-rest-of-ahp-1-1-0.md`, the ten 1.1.0 changes; this plan covers changeset `status` and nonces
  - git://github.com/microsoft/agent-host-protocol@v1.1.0 - `ChangesetFile.status`, `ChangesetFileStatus.Editing`, `ChangesetFile.nonce` and the target `nonce` in `types/channels-changeset/`; `AhpErrorCodes.Conflict` is `-32011`
  - git://github.com/microsoft/vscode@7e993177c9d9 - `node/agentHostChangesetService.ts` sets `Editing` at an edit's start and clears it with a fresh compute; `node/agentHostAcceptChangesOperationHandler.ts` refuses a target whose nonce differs
  - "[code://packages/sdk/src/types/changes.ts#L532](../../../../packages/sdk/src/types/changes.ts#L532) - `observe`, told `before` when an edit starts and `after` when it ends"
  - "[code://packages/sdk/src/sessions/changes.ts#L712-L740](../../../../packages/sdk/src/sessions/changes.ts#L712-L740) - `rowsOf`, the rows of a turn's captured sides"
  - "[code://packages/sdk/src/sessions/changes.ts#L859-L870](../../../../packages/sdk/src/sessions/changes.ts#L859-L870) - `look`, the rows of the working tree"
  - "[code://packages/sdk/src/sessions/changes.ts#L1822-L1840](../../../../packages/sdk/src/sessions/changes.ts#L1822-L1840) - `invoke`, which takes an operation's target"
---

## Goal

A changeset file says while an agent is editing it, so a client can hold back Keep and Undo on it. Each file has a nonce. The host refuses an operation that names an old nonce, so a person never keeps or undoes a change they did not see.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -l "nonce|ChangesetFileStatus" packages/sdk/src/sessions packages/sdk/src/host` on 2026-11-24 - no changeset code names either.
- `rg -n "observe" packages/sdk/src/types/changes.ts` - the host tells the source `before` and `after` around each file edit.

### Gaps

- No row has `status` or `nonce`.
- `invoke` does not read a target's `nonce`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan every item of the brief in one pass, six plans by feature | Softov, 2026-11-24 | - |
| A file is `Editing` from `observe`'s `before` to its `after` | `(defaulted: the edit's start and end, as VS Code marks them)` | 01 |
| The mark is set at once and cleared with the next fresh read of the rows | `(defaulted: VS Code clears it only with a fresh compute)` | 01 |
| A nonce is a hash of the row's two sides | `(defaulted: it changes whenever the content does, as 1.1.0 asks)` | 02 |
| A target whose nonce differs fails with `Conflict`, `-32011`; a target with no nonce is not checked | `(defaulted: 1.1.0 and VS Code)` | 02 |

## Proposed architecture

- **Data flow** - `observe` keeps the set of paths being edited per folder; the rows read it for `status`, and hash their sides for `nonce`.
- **Event flow** - an edit's start sends `changeset/fileSet` with `Editing`; its end reads the rows again, as a turn's edits already do.
- **Layer responsibilities** - sdk sessions: the mark, the nonce and the check.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/changes.ts`](../../../../packages/sdk/src/sessions/changes.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a file being edited is marked](task-01-a-file-being-edited-is-marked.md) | done | - |
| [02 - an operation checks the nonce](task-02-an-operation-checks-the-nonce.md) | done | - |
| [03 - the documents say it](task-03-the-documents-say-it.md) | done | 01, 02 |

## Risks and tradeoffs

- An edit that never says `after` would keep its mark - the turn's end clears every mark of its folder.

## Resume state

- **Done so far:** tasks 01 to 03, on 2026-11-24.
- **Next action:** Softov's review, then `status: built`.
- **Open questions:** none.
- **Watch out for:** `status` is a bitset; keep bits this host does not know.

## Final verification checklist

- [ ] A file shows `Editing` between an edit's start and end.
- [ ] A row's nonce changes when its content does.
- [ ] An operation with an old nonce fails with `-32011`.
- [ ] The sdk suite passes, and then the whole repo.
