---
title: The turns before a compaction read back
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L52-L72](../../../../packages/agent-claude/src/transcript.ts#L52-L72) - `turnsOf`, where the segment reads go"
  - "[code://packages/agent-claude/src/transcript.ts#L104-L130](../../../../packages/agent-claude/src/transcript.ts#L104-L130) - `answeredIn`, the line read to copy"
  - "[code://packages/agent-claude/test/agent-claude-transcript.test.ts](../../../../packages/agent-claude/test/agent-claude-transcript.test.ts) - the mocked cases"
---

## Objective

`turnsOf` gives every turn of a Claude session, also the turns before each compaction, in the order they ran.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:52-72` - `turnsOf` reads each segment before a compaction and joins the reads.
- `UPDATE: packages/agent-claude/test/agent-claude-transcript.test.ts` - mocked cases for the joined read.
- `CREATE: packages/agent-claude/test/agent-claude-compacted-history.test.ts` - a case with the real SDK on a written transcript with two compactions.

## Steps

1. Add `entriesBefore(file)` to `transcript.ts`, which reads the file line by line, as `answeredIn` does.
2. Make `entriesBefore` give the parsed entries before the last `compact_boundary`, and the index of each boundary among them.
3. Make `entriesBefore` skip a line that does not parse, and give no boundaries for a file that does not read.
4. In `turnsOf`, call `entriesBefore` only when the first message from `getSessionMessages` is a `system` entry.
5. Read the earlier segments only when a `compact_boundary` entry in the file has that message's uuid.
6. For each boundary, call `getSessionMessages` with `includeSystemMessages: true` and a `sessionStore` whose `load` gives the entries before that boundary.
7. Give the `sessionStore` an `append` that does nothing.
8. Join the segment reads and the read from the last boundary, in file order.
9. Keep a message only at the first place its `uuid` comes.
10. Keep the read from the last boundary alone when a segment read throws.
11. Run `askedIn`, `answeredIn` and `buildTurns` over the joined messages.
12. Update the doc comment of `turnsOf` to say it reads across compactions, and why it uses a `sessionStore`.
13. Add the mocked cases to `agent-claude-transcript.test.ts`.
14. Write the real SDK case in `agent-claude-compacted-history.test.ts`, with a temporary `CLAUDE_CONFIG_DIR`.

## Validation

- `agent-claude-transcript.test.ts`, mocked:
  - A read whose first message is not a `compact_boundary` makes one SDK call, with no `sessionStore`.
  - A transcript with one boundary gives the turns before it first.
  - A message in two reads shows once, at its first place.
  - A segment read that throws gives the turns from the last boundary, as now.
  - A question answered before a compaction keeps its answers.
- `agent-claude-compacted-history.test.ts`, with the real SDK:
  - A written transcript with two compactions, each with `parentUuid: null` and a `logicalParentUuid`, reads back every prompt once, in order.
- Run `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/agent-claude`, and expect every case to pass.
- Run `git checkout -- packages/sdk/test/fixtures/wire.jsonl` after the run.
- Run `pnpm typecheck`, and expect no error.
- By hand: start the test daemon with `.project/pending/test-daemon.sh`.
- By hand: read the history of session `8cf0f145`, and expect its first turn at 15:29 UTC.

## Resume

- Implemented on 2026-11-15, not committed, in `/github/ahpd.worktrees/claude-history`.
- `withEarlierSegments` and `entriesBefore` in `transcript.ts` read each segment, and `turnsOf` looks up the file once for all its reads.
- The cases with a compaction fail on main's `transcript.ts`, and pass on the branch.
- The agent-claude suite passes, 679 of 679, and `pnpm typecheck` passes.
- The check by hand ran as a read of session `8cf0f145` with the branch's `turnsOf`, because `test-daemon.sh` runs origin/main.
  - Main gives 3 turns, the first a reply of the preserved segment with no prompt.
  - The branch gives 13 turns, each with its prompt, the first at the session's first entry, from 15:29:16 UTC.
- The test daemon check runs after the merge.

