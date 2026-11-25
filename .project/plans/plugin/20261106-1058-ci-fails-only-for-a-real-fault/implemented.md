---
title: CI fails only for a real fault - implemented
date: 2026-11-21
refs:
  - "[code://packages/activepieces/src/files.ts](../../../../packages/activepieces/src/files.ts) - `attachmentOf` opens a streamed file before it returns"
  - "[code://packages/activepieces/test/files.test.ts](../../../../packages/activepieces/test/files.test.ts) - the case for a file that will not open"
  - "[code://tools/wait.ts](../../../../tools/wait.ts) - `WAIT_MS`, the limit the cofold waits took"
---

Three of the five cases were fixed before this build, and the record is brought up to date with them.

- The cofold waits take `WAIT_MS` (`1e0251f5c`). The server check runs without Docker (#396). The attachment case holds its turn until it takes its steering (`be174c104`).
- A streamed attachment is opened before its body is handed on. A file that goes in between is then no file, not a stream error in the daemon.
- The titling and attachment problem records are deleted, and the three-case record holds only the two computer cases.

Where it departs from the plan:

- The cofold `when` keeps a deadline, `WAIT_MS`, rather than losing it. The suite took that rule after the plan was written.
- Task 04 needed no product fix: its cause was in the case, and the case is fixed.

Verified on 2026-11-21:

- `files.test.ts` passes 24 runs in a row with no unhandled error.
- `host-attachments.test.ts` passes 50 runs in a row on Linux.
- `pnpm typecheck` and `pnpm boundary` pass.
- No cofold tools case and no attachment case failed in a failed CI run since the plan was written. The two server-check failures since then came before #396.
- Not yet: the PR's CI, Windows jobs included, with no rerun.
