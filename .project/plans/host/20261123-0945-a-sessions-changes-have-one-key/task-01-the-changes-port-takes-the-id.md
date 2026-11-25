---
title: The changes port takes the session id
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L1974-L1978](../../../../packages/sdk/src/host/spawn.ts#L1974-L1978) - `observe` called with the URI"
  - "[code://packages/sdk/src/host/changesets.ts#L120](../../../../packages/sdk/src/host/changesets.ts#L120) - `scopes` called with the URI"
---

## Objective

Every call of the changes port passes `idOf(uri)` as `session`, and the port's type says so. The tracker and the checkpoints then answer for the same session.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts:400-527` - document `session` as the session id on `scopes`, `state`, `sessionSummary`, `checkpoint` and `observe`.
- `UPDATE: packages/sdk/src/host/spawn.ts:1974-1978` - pass `idOf(uri)` to `observe`, and to the file-question path beside it if it names the session.
- `UPDATE: packages/sdk/src/host/changesets.ts:120` - pass `idOf(uri)` to `scopes`.
- `UPDATE: packages/sdk/src/host/changesets.ts:662` - pass `idOf(at.owner)` to `state`.
- `UPDATE: packages/sdk/src/host/snapshots.ts:514` - pass `idOf(at.owner)` to `state`.
- `UPDATE: packages/sdk/src/host/actions.ts:680` - pass `idOf(at.owner)` to `state`.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the cases of a shell-written file and a folder with no git.

## Steps

1. Run `rg "options\.changes\?\.\w+\(" packages/sdk/src` and list every call that passes a session.
2. Change each listed call to pass `idOf(...)` of the URI it has now.
3. Write the `session` contract on each port method in `types/changes.ts`.
4. Add a case where a shell command writes a file after the baseline, and the `session` scope's state lists it.
5. Add a case in a folder with no git, where an edit through `observe` gives the session's summary counts.

## Validation

- `changes-refresh.test.ts`: the two new cases.
- `checkpoints.test.ts` and `chat-changesets.test.ts` pass unchanged.
- Run the sdk suite under the lock, with `TMPDIR` set, and then the computer suite.

## Resume

Done on 2026-11-23. `propose`, `settle`, `complete`, `operations`, `review`, `chatSummary` and the source's `invoke` also take the id, because they read the same tracker. Two tests that stood in for the host now pass the id.
