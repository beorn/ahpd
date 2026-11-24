# Upstream asks — host chat binding and conversation provenance

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

2 issues / 7 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## A chat's backend id reaches disk only after its first turn, so a host killed mid-start forgets it

**Patch:** `patches/host-chat-binding-before-first-prompt.patch` (4 commits: `84441da`, `2ab6dcb`, `a8bc5f4`, `99935dd`; `84441da` is `2ab6dcb` replayed by a rebase — one change, carried twice)

**What happens today.** The backend names a chat's conversation at handshake, and the host holds that binding in memory until the chat's next turn end, when the coalesced store pass writes it. A backend that answers at handshake and then sends its first prompt has no turn-end event in between, so nothing on disk ever names the conversation. A host killed in that window reopens the session with no backend chat id: it starts a second conversation instead of resuming the one the backend still holds, and the first is orphaned. A second defect sits in the same window: on create, the conversation binding was kept before the session's folder, and the save writes the whole row, so the first record file can carry no working directory at all.

**What the patch does.** One `keepBackendId()` is called at handshake as well as at turn end, and a changed chat binding is written before its setter returns, because a handshake may be the last host callback before the backend starts prompting. On create the harness and folder are recorded before the binding is saved, since a row holding only a folder counts as empty and is not kept. A backend id known eagerly at registration is retained rather than dropped.

**Evidence.** `packages/sdk/test/host-chats.test.ts`, `persists a backend-minted chat id before its first prompt, without a turn-end event`, and the registration case beside it. `host-past-open`'s `writes the folder of a session it creates into the record file` fails without the third commit: the record has no `workingDirectory`, and restore-on-open reopens it folderless.

**For review.** `packages/sdk/src/host/spawn.ts` and the write coalescing in `packages/sdk/src/sessions/sessions.ts`. The binding write moves into the setter's return path on a hot path, so check that it cannot fsync per keystroke — it only fires when the id actually changed. The change assumes a handshake precedes a lazy backend's first prompt; a backend that prompts without a handshake keeps today's behaviour.

## A chat's conversation provenance is never recorded, so a peer is resumed as the original

**Patch:** `patches/host-conversation-provenance.patch` (3 commits: `daa329f`, `46db0cb`, `5e9bb69`)

**What happens today.** A session's row records each chat's backend id, provider and config, but not whether that conversation is the session's own or a peer's (a subagent, a fork, an alias). On restart the host can only infer it from the current default and the aliases, both of which move: a peer becomes the original, or an original becomes a peer, and a resume follows the wrong conversation. Rows written before this change carry no provenance at all.

**What the patch does.** `sessionConversation?: boolean` is added to the stored chat row and to a start's channel: true for the session's own conversation, false for a peer, absent for a legacy row whose provenance is unknown. The host records it before the backend is created, keeps session-id and legacy aliases as peers, projects it at startup, and preserves it across a chat's lifecycle — changesets, tooling calls and close no longer drop it.

**Evidence.** `packages/sdk/test/sessions.test.ts`, `keeps original, peer and unknown conversation provenance across a synchronous file-store restart`, which covers all three states including the absent one. `packages/sdk/test/host-chats.test.ts`, `records the original before backend create and keeps session-id and legacy aliases as peers`. Without the patch both restart projections lose the distinction and the peer is read as the original.

**For review.** Additive optional field in `packages/sdk/src/types/{sessions,agent}.ts`, threaded through `host/{chatrecord,spawn,changesets,tooling,lifecycle,sessionmethods}.ts`. The one rule every reader must keep: **absent means unknown**, never false — a legacy row must not be reclassified as a peer. It stacks on the binding ask above; alone it records nothing.

**Verdict: upstreamable as one protocol-adjacent change**, but it adds a field to a stored record format. Decide whether that wants a schema note before a PR.
