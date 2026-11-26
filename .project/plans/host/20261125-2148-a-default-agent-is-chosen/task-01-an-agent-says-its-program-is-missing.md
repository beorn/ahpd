---
title: An agent says its program is missing
status: done
depends: []
layer: "sdk, agent-acp, server"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L851](../../../../packages/sdk/src/types/agent.ts#L851) - `Agent`, which gets the optional member"
  - "[code://packages/agent-acp/src/connection.ts#L210-L216](../../../../packages/agent-acp/src/connection.ts#L210-L216) - the spawn, whose command and environment the check must match"
  - "[code://packages/server/src/found.ts#L27](../../../../packages/server/src/found.ts#L27) - an importer of `onPath`"
---

## Objective

An `Agent` may answer the program it needs and cannot find. The ACP agent answers it for a command that is not on its PATH.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:1029` - add `missingProgram?(): string | undefined`, the name of a program that is not found.
- `CREATE: packages/sdk/src/utils/onpath.ts` - `onPath` and `OnPathLookup`, moved from the server unchanged.
- `DELETE: packages/server/src/onpath.ts` - moved to the sdk.
- `UPDATE: packages/sdk/src/index.ts` - export `onPath` and `OnPathLookup`.
- `UPDATE: packages/server/src/found.ts` - import `onPath` from the sdk.
- `UPDATE: packages/server/src/doctor.ts` - import `OnPathLookup` from the sdk.
- `DELETE: packages/server/test/onpath.test.ts` - moved to the sdk with the code.
- `CREATE: packages/sdk/test/onpath.test.ts` - the moved cases.
- `UPDATE: packages/agent-acp/src/agent.ts` - answer `missingProgram` from the command and its `env` PATH.
- `UPDATE: packages/agent-acp/test` - the cases for the check.

## Steps

1. Move `onpath.ts` to `packages/sdk/src/utils/` and export it.
2. Change the two server imports and the test import.
3. Add `missingProgram?()` to `Agent`, with a doc comment that says what an absent member means.
4. Answer it in the ACP agent with `onPath`, on the PATH the spawn gives the program.
5. Answer nothing for a relative command with a folder in it, because it runs against each session's folder.

## Validation

- A case each: command found, command missing, absolute path, relative path, own `env.PATH`, and a record with a machine block.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/agent-acp/test packages/sdk/test/onpath.test.ts` passes.

## Resume
