---
title: A Claude history reads across its compactions
domain: claude
status: built
priority: high
created: 2026-11-15
revalidated: 2026-11-15
refs:
  - git://f387bc7b1 - the last commit that holds the problem this plan fixes, .project/problems/a-claude-history-starts-at-its-last-compaction-after-a-restart.md
  - "[code://packages/agent-claude/src/transcript.ts#L52-L72](../../../../packages/agent-claude/src/transcript.ts#L52-L72) - `turnsOf`: one `getSessionMessages` read, which starts at the last compaction"
  - "[code://packages/agent-claude/src/transcript.ts#L104-L130](../../../../packages/agent-claude/src/transcript.ts#L104-L130) - `answeredIn`: the line-by-line read of the transcript file to copy"
  - "[code://packages/agent-claude/src/transcript.ts#L142-L152](../../../../packages/agent-claude/src/transcript.ts#L142-L152) - `sessionFiles`: finds the transcript file by the session's id"
  - "[code://packages/agent-claude/src/transcript.ts#L575-L588](../../../../packages/agent-claude/src/transcript.ts#L575-L588) - `buildTurns` draws a `compact_boundary` on the turn before it, so joined reads need no change there"
  - "[code://packages/agent-claude/src/transcript.ts#L523](../../../../packages/agent-claude/src/transcript.ts#L523) - a compact summary is no prompt"
  - "[code://packages/agent-claude/src/session/query.ts#L1067-L1090](../../../../packages/agent-claude/src/session/query.ts#L1067-L1090) - a live boundary draws as `Conversation compacted`, the `content` of its transcript entry; the comment says a turn read back shows none"
  - "[code://packages/agent-claude/src/claude.ts#L683-L697](../../../../packages/agent-claude/src/claude.ts#L683-L697) - `transcript`, the caller after a restart, which keeps each turn's fork anchor"
  - "[code://packages/agent-claude/test/agent-claude-transcript.test.ts](../../../../packages/agent-claude/test/agent-claude-transcript.test.ts) - the mocked `getSessionMessages` cases, where the mocked cases go"
  - "[code://docs/sdk/CHATS.md#L79](../../../../docs/sdk/CHATS.md#L79) - says every turn stays readable after a compaction, which this plan makes true"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.325 - `getSessionMessages` with `sessionStore` (`@alpha`), which loads entries through `load` and builds messages from them as from the file
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/claude/claudeSavedChatReader.ts - VS Code's Claude agent reads the same way and shows the same cut
---

## Goal

After a daemon restart, a Claude session shows every turn it ran, also the turns before its compactions.
Today it shows only the turns from its last compaction on, although the transcript file holds all of them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "turnsOf" packages/agent-claude/src` - one read path, `transcript` and `subagents` in `claude.ts`.
- `rg -i "compact" docs packages/agent-claude/README.md` - [docs/sdk/CHATS.md](../../../../docs/sdk/CHATS.md) already says that a compaction drops no turn. No document changes.
- Probes on session `8cf0f145`, 1314 lines, one `compact_boundary` at line 1220, read with SDK 0.3.325:
  - `getSessionMessages` gives 22 messages, from the boundary on.
  - A `sessionStore` that relinks the boundary's `parentUuid` still gives 22, so the SDK cuts at a boundary on its own.
  - A `sessionStore` whose `load` gives the entries before line 1220 gives 424 messages, from 15:29:16 to 18:35:46 UTC.
  - A cut after the boundary's `logicalParentUuid` gives the same 424 messages. Only metadata entries lie between the two cuts.
  - Five messages are in both reads: the last five of the earlier read, which `compactMetadata.preservedSegment` copies after the boundary.

### Runtime path

```
session history after a restart -> claude.ts transcript -> turnsOf -> getSessionMessages per segment -> buildTurns -> turns to every client
```

### Gaps

- `turnsOf` reads only from the last compaction on.
- The SDK gives a system entry with no `message`, because the file keeps its `subtype` and `content` at the top level. `buildTurns` reads `message.subtype`, so a read-back turn draws no compaction notice and no notification. The mocked case in `agent-claude-transcript.test.ts` gives a shape the SDK does not give.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each segment before a compaction is read through `getSessionMessages` with a `sessionStore` whose `load` gives the file's entries before that boundary. The reads are joined in file order, before the read from the last boundary | Softov chose "SDK reads each part", 2026-11-15 | 01 |
| The file is read for the earlier segments only when the SDK's first message is a `system` entry, and a `compact_boundary` entry in the file has its uuid | (defaulted: a session with no compaction reads as now, with one SDK call; the SDK's message holds no subtype) | 01 |
| A segment's store gives every parsed entry before its boundary, in file order | (defaulted: the probe gives the same read for both cuts, and a preserved segment can name earlier entries) | 01 |
| A message that two reads give keeps its first place | (defaulted: the preserved segment came before the compaction in the live session) | 01 |
| The file is read line by line, as `answeredIn` reads it, and the read stops at the last boundary | (defaulted: the file of a long session can be longer than one string) | 01 |
| A segment read that fails, or a file that does not read, leaves the read from the last boundary as it is | (defaulted: `turnsOf` is best effort, and a part of the history is better than none) | 01 |
| `askedIn` and `answeredIn` run over the joined messages | (defaulted: a question before a compaction keeps its answers) | 01 |
| A case with the real SDK reads a written transcript with two compactions | (defaulted: `sessionStore` is `@alpha`, so an SDK bump that changes it fails the suite) | 01 |
| No document changes | (defaulted: [docs/sdk/CHATS.md](../../../../docs/sdk/CHATS.md) already says every turn stays readable) | 01 |
| A read-back turn draws its compaction notices and notifications as a live turn draws them. The `subtype` and `content` of each system entry come from the file | Softov chose "Fix it in this plan", 2026-11-15 | 02 |
| The file is read for system entries only when the SDK gives one, and only lines that name `"system"` are parsed | (defaulted: the same scan as `answeredIn`) | 02 |
| A boundary draws its `content`, and `[compact_boundary]` when it has none | (defaulted: the live notice is `Conversation compacted`, the `content` the CLI writes) | 02 |
| The mocked cases give system entries with no `message`, as the SDK does | (defaulted: a case must give the SDK's shape) | 02 |

## Proposed architecture

- **Data flow** - `turnsOf` reads from the last boundary as now. When the first message is a `compact_boundary`, it reads the file up to the last boundary. For each boundary, it reads the entries before it through a `sessionStore`. It joins the reads, keeps each uuid once, and gives the result to `buildTurns`. Before that, it fills each system message's `subtype` and `text` from its file entry.
- **Event flow** - none. The turns reach clients as they do now.
- **State flow** - none. Each read is done when the session opens, as now.
- **Layer responsibilities** - agent-claude: the segment reads. No change in sdk, server or clients.
- **Source-of-truth files** - [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the turns before a compaction read back](task-01-the-turns-before-a-compaction-read-back.md) | done | - |
| [02 - a read-back turn draws its notices](task-02-a-read-back-turn-draws-its-notices.md) | done | 01 |

## Risks and tradeoffs

- `sessionStore` is `@alpha`. The real SDK case fails when a bump changes it, and the read from the last boundary stays as a fallback.
- A session with many compactions costs one SDK read per compaction, each over a longer prefix. That cost comes only when a session opens after a restart.
- A session with a system entry reads its file once more when it opens, also with no compaction. Only the lines that name `"system"` are parsed.
- The parsed entries before the last boundary stay in memory during the read. The read stops at the last boundary, so the entries after it are never parsed twice.

## Resume state

- **Done so far:** plan written, 2026-11-15. Task 02 added the same day, after the build of task 01 found that the SDK gives a system entry with no subtype.
- **Done so far, build:** tasks 01 and 02 implemented, 2026-11-15, not committed. The agent-claude suite passes, 679 of 679. Session `8cf0f145` reads back 13 turns with the branch, and 3 with main.
- **Merged:** #338, as `9863785ca`, on 2026-11-15, with check and check-windows green on run 43667174169.
- **Checked by hand:** the test daemon at `9863785ca` serves session `8cf0f145` as 13 turns, each with its prompt, from `b1a85f09`. `Conversation compacted` is on turn `2c3d4ffb`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** a turn before a compaction now has a fork anchor after a restart. A live session already has one for such a turn, so a fork or a rewind there behaves as it does live.

## Final verification checklist

- [x] Session `8cf0f145` on the test daemon shows its first turn at 15:29 UTC.
- [x] A session with no compaction makes one SDK call, as now.
- [x] Session `8cf0f145` draws `Conversation compacted` on the turn of its compaction.
- [x] A transcript with two compactions reads back every turn once, in order.
- [x] The agent-claude suite passes, and check and check-windows are green.
