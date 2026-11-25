---
title: A read-back turn draws its notices
status: done
depends: [task-01-the-turns-before-a-compaction-read-back.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L575-L588](../../../../packages/agent-claude/src/transcript.ts#L575-L588) - `buildTurns` draws a system message by its `message.subtype`, which the SDK leaves out"
  - "[code://packages/agent-claude/src/transcript.ts#L104-L130](../../../../packages/agent-claude/src/transcript.ts#L104-L130) - `answeredIn`, the line scan to copy"
  - "[code://packages/agent-claude/src/session/query.ts#L1067-L1090](../../../../packages/agent-claude/src/session/query.ts#L1067-L1090) - the live notice, and the comment that a read-back turn shows none"
  - "[code://packages/agent-claude/test/agent-claude-transcript.test.ts#L39-L60](../../../../packages/agent-claude/test/agent-claude-transcript.test.ts#L39-L60) - the mocked case with a shape the SDK does not give"
---

## Objective

A Claude turn read back from its transcript draws its compaction notices and notifications, with the text a live turn draws.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts` - `turnsOf` fills each system message's `subtype` and `text` from the file.
- `UPDATE: packages/agent-claude/src/session/query.ts:1067-1090` - the comment no longer says a read-back turn shows none.
- `UPDATE: packages/agent-claude/test/agent-claude-transcript.test.ts:39-60` - the case gives system entries with no `message`, and writes their entries to a file.
- `UPDATE: packages/agent-claude/test/agent-claude-compacted-history.test.ts` - the real SDK case expects a notice on the turn of each compaction.

## Steps

1. Add `systemIn(file, wanted)` to `transcript.ts`, which scans the file line by line, as `answeredIn` does.
2. Make `systemIn` parse only the lines that name `"system"`, and give each wanted entry's `subtype` and `content` by uuid.
3. Make `systemIn` stop when it found every wanted uuid.
4. In `turnsOf`, call `systemIn` only when a joined message has `type: 'system'` and no `message`.
5. Give each such message `message: { subtype, text: content }` from its entry.
6. Leave a system message with no file entry as the SDK gave it.
7. Update the comment in `query.ts` to say a read-back turn draws the same notice.
8. Update the mocked case to give the SDK's shape, with the entries in a file under a temporary `CLAUDE_CONFIG_DIR`.

## Validation

- `agent-claude-transcript.test.ts`, mocked:
  - A boundary with `content` draws that text on its turn.
  - A boundary with no `content` draws `[compact_boundary]`.
  - A notification draws its `content` on its turn.
  - An `api_error` entry draws nothing.
  - A read with no system message reads no file.
- `agent-claude-compacted-history.test.ts`, with the real SDK:
  - Each compaction draws one notice, on the last turn before it.
- Run `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/agent-claude`, and expect every case to pass.
- Run `git checkout -- packages/sdk/test/fixtures/wire.jsonl` after the run.
- Run `pnpm typecheck`, and expect no error.
- By hand: read the history of session `8cf0f145` on the test daemon.
- By hand: expect `Conversation compacted` on the turn of its compaction.

## Resume

- Implemented on 2026-11-15 with task 01, not committed.
- `withSystemText` and `systemIn` in `transcript.ts` fill each system message from its entry.
- No case checks that a read with no system message reads no file, because the read has no effect a case can see. The case with no compaction checks one SDK call.
- Session `8cf0f145` draws `Conversation compacted` on turn `2c3d4ffb`, the prompt the compaction ran under, before its reply.

