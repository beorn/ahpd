---
title: the copapo preset comment
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/presets.ts#L212-L218](../../../../packages/agent-acp/src/presets.ts#L212-L218) - the comment that says copapo over ACP ignores `mcpServers`"
  - "[code://packages/agent-cofold/src/capabilities.ts](../../../../packages/agent-cofold/src/capabilities.ts) - not a file of this task; the ACP side is checked against copapo's own code"
---

## Objective

The copapo preset comment says what copapo does today over ACP, and no more.

## Files

- `UPDATE: packages/agent-acp/src/presets.ts` - reword the comment, or remove it if the behaviour changed.

## Steps

1. Read copapo's ACP server in `/github/cofold/packages/copapo/src/acp` and find how it handles `mcpServers`.
2. Decide from that code whether the comment is still true.
3. Reword or remove the comment to match the code.
4. Run `pnpm typecheck`.

## Validation

- The comment matches what copapo's ACP server does, as read in step 1.

## Result

The comment was stale. copapo 0.2.0 declares `mcpCapabilities: { http: true, sse: false }`, takes stdio and http servers from `session/new`, and warns on an SSE one. 0.1.0 took none. The comment now says so.
