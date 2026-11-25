---
title: A sent attachment is gone from its message after a restart, though its file is kept
status: open
date: 2026-11-23
severity: major
refs:
  - git://bfac3a633 - the commit of ahpd the cause was read at; the files below are the same at 4ac58cbbc
  - "[code://packages/agent-claude/src/transcript.ts#L787-L793](../../packages/agent-claude/src/transcript.ts#L787-L793) - a user turn read back from the CLI's transcript is `{ text, origin }`, with no attachments"
  - "[code://packages/sdk/src/host/localturns.ts#L175-L194](../../packages/sdk/src/host/localturns.ts#L175-L194) - `Recorded`, a turn's record: its transcript id, its turn id and its origin"
  - "[code://packages/sdk/src/host/localturns.ts#L379-L389](../../packages/sdk/src/host/localturns.ts#L379-L389) - `turnRecordedAs`, which writes the record"
  - "[code://packages/sdk/src/host/localturns.ts#L554-L570](../../packages/sdk/src/host/localturns.ts#L554-L570) - `begunWithOrigins`, which puts a recorded origin back on a read-back turn"
  - "[code://packages/sdk/src/host/spawn.ts#L2032](../../packages/sdk/src/host/spawn.ts#L2032) - where a turn is recorded, with its origin"
  - "[code://packages/sdk/src/host/attachments.ts#L230-L241](../../packages/sdk/src/host/attachments.ts#L230-L241) - `tagged`, the attachment that names the file the host wrote"
  - "[code://.project/specs/sessions-and-chats.md#L376-L386](../specs/sessions-and-chats.md#L376-L386) - the spec: an attachment's bytes are written to disk and the attachment names the file"
  - https://github.com/microsoft/vscode/blob/1564f100807a84771bfb1a9886fff6eeaca6b147/src/vs/platform/agentHost/node/codex/codexReplayMapper.ts#L106-L249 - VS Code's Codex replay puts a turn's images back on its message as `resource` attachments
  - https://github.com/microsoft/vscode/blob/1564f100807a84771bfb1a9886fff6eeaca6b147/src/vs/platform/agentHost/node/codex/codexReplayMapper.ts#L260-L262 - and finds the snapshot files of older turns by their path under the session's attachments folder
---

## Symptom

Softov saw this on 2026-11-23 in ahpapp, in a Claude session.

1. Photos and screenshots were sent with messages from the clients. Each showed as an attachment of its message.
2. ahpd was restarted.
3. In ahpapp, the same messages showed with no attachments.

The files are still on disk. The session `229a97fe-a42f-4522-b62d-ea15fac2c814` holds 126 files under `~/.config/ahpd/sessions/attachments/229a97fe-a42f-4522-b62d-ea15fac2c814/`, today's photos among them.

## Cause

Read from the code, not confirmed by a test.

- The host writes each attachment's bytes to a file and sends the message on with a `resource` that names the file ([`code://packages/sdk/src/host/attachments.ts`](../../packages/sdk/src/host/attachments.ts#L230-L241)).
- After a restart, the Claude backend reads its turns back from the CLI's transcript. A user turn comes back as `{ text, origin }` ([`code://packages/agent-claude/src/transcript.ts`](../../packages/agent-claude/src/transcript.ts#L787-L793)).
- The host's record of a turn keeps its transcript id, its turn id and its origin, and no attachments ([`code://packages/sdk/src/host/localturns.ts`](../../packages/sdk/src/host/localturns.ts#L175-L194)). A record on disk reads `{ "version": 1, "transcriptId": "…", "turnId": "…" }`.
- `begunWithOrigins` puts a recorded origin back on a read-back turn ([`code://packages/sdk/src/host/localturns.ts`](../../packages/sdk/src/host/localturns.ts#L554-L570)). Nothing does the same for attachments.

## Impact

- Every sent attachment of a Claude session is gone from its message after a restart, for every client. The other backends that read their turns back were not checked.
- A client cannot show a sent picture again, though its file is kept.
- ahpapp draws a sent picture as a thumbnail over its message, and its gallery shows every picture of a chat (ahpapp `bb1d2a0`). Both are empty after a restart. ahpw has a brief for the same view.
- The agent is not affected: its transcript keeps what it was sent.

## Workaround

None in a client. The files can be opened by path from the session's attachments folder.

## Fix

No fix is chosen.

- **Record them:** the record keeps the message's attachments, as the host rewrote them, beside its origin. `begunWithOrigins` puts them back with the origin. This follows the origin's path through `turnRecordedAs` and `Recorded`.
- **Read them back:** the Claude backend reads a turn's image and document blocks out of the transcript, as VS Code's Codex replay does. Base64 images there have no file, so this gives a picture but not the host's file.
- **Turns recorded before the fix:** their records hold no attachments. Each sent attachment has a file in its own folder under the session's attachments folder. VS Code's Codex replay finds such files by their path. Whether ahpd matches them to turns, and how, is open.
- **Other work:** the branch `host/20261123-0945-a-sessions-changes-have-one-key` changes `packages/sdk/src/host/spawn.ts`. A fix that passes the attachments where `turnRecordedAs` is called meets it there.
