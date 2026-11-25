---
title: A changeset file says it is being edited - implemented
date: 2026-11-24
refs:
  - "[code://packages/sdk/src/sessions/changes.ts](../../../../packages/sdk/src/sessions/changes.ts) - the marks and the nonces"
  - "[code://packages/sdk/src/host/changesets.ts](../../../../packages/sdk/src/host/changesets.ts) - `editingMoved`"
  - "[code://packages/sdk/src/host/resourcemethods.ts](../../../../packages/sdk/src/host/resourcemethods.ts) - the nonce check"
---

A changeset file has `status` `Editing` while an agent edits it. Each file has a `nonce`. An operation that names another nonce is refused with `-32011`, and the changeset is said as it is now.

## Verified

- `changes-editing.test.ts`: six cases.
- The whole repository's `pnpm test`: 611 files, 10512 cases.

## Departures from the plan

- The check is in the host, not in the source's `invoke`, so a contributed operation is checked too.
- The `before` side of a git row is known by its commit, and not by its content. A commit moves the nonce of every row.
- A file larger than 4 MB is known by its size and time.
- The nonce is in the signature that `refresh` compares. A change that moves no count now reaches a client.
- A turn's row is known by its captured sides. A later edit of the file on disk does not move that nonce.
