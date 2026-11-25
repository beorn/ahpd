---
title: A restart refused through AHP answers -32603
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/commands/restart.ts#L900-L915](../../packages/server/src/commands/restart.ts#L900-L915) - `restartMethod`, which answers every refusal but the caller's as an internal error"
  - "[code://packages/server/src/commands/restart.ts#L867](../../packages/server/src/commands/restart.ts#L867) - `servedRestart`, whose refusals reach it"
  - git://216ce3f2 - daemon/20261030-0635 added the restart method
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A client asks for a restart through AHP, and the daemon refuses it for a reason other than the caller.
The client gets -32603, an internal error, and tells the refusal apart from a fault by its text only.
The `--force` wording the record first named is gone: since `3af3624c7` a restart that finds a turn running waits for it rather than refusing.

## Cause

`restartMethod` turns every error that is not already an `RpcError` into `INTERNAL_ERROR`.
Only the caller refusal has its own code, `REFUSED`.

## Impact

A client cannot tell a refusal from a fault in the daemon, except by its text.

## Workaround

Read the error's text.

## Fix

- Answer each refusal `servedRestart` can give with a conflict code, not -32603.
