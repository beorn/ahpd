# Upstream asks — host prompt, sleep and close

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

5 issues / 8 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## A session's initial prompt is never settled on disk after its turn ends

**Patch:** `patches/host-settle-initial-prompt.patch` (2 commits: `eb5b5e4`, `af158c8`)

**What happens today.** A host accepting an initial prompt records it as an uncertain admission, and nothing moves the record on when that prompt's turn ends. After a restart the row still says the prompt was admitted and never that it finished, so a reader cannot tell a completed prompt from one that was cut off.

**What the patch does.** The host remembers the channel and turn id of the exact initial turn it admitted and settles the record only on that turn's end event, writing `initialPrompt: 'settled'` and committing the row. Another turn's terminal event is ignored, because a successor cannot infer the outcome of an admission it never observed. The write joins the tracker a close already waits on.

**Evidence.** `packages/sdk/test/plugin-start-session.test.ts`, `it('durably settles the initial prompt after its actual terminal event')`, red first in `eb5b5e4`. Without the patch the file's `creation.initialPrompt` stays `admitted` after `chat/turnComplete`; the test also asserts the folder stays locked until the write lands, which needs the writer-lock ask.

**For review.** Touches `packages/sdk/src/host/automations.ts`, `host/spawn.ts`, `host/context.ts` and `host.ts`. The state it settles comes from a separate durable-creation-record series, so this will not apply alone. It treats a missing or unexpected-phase reservation as an error, logged and not retried — decide whether that suits a recovered session or should be a skip.

## A stop leaves a session that has never taken a turn running until it is reaped

**Patch:** `patches/host-sleep-archived-or-never-spoken.patch` (3 commits: `9f17161`, `8c16321`, `e1b7097`)

**What happens today.** Archiving sleeps a session at once, and a stop archives. Three refusals each leave the agent running until its window expires and the child is reaped with SIGTERM: a chat with no turns is refused for having nothing to resume by, even when archived; a non-resumable chat is refused even for a stop; and the archive handler returns early when the archived bit did not move, so a sleep refused for the watchers of that moment is never asked again.

**What the patch does.** An archived session's zero-turn chat may sleep, and a stop's archive offer may sleep a never-spoken, non-resumable chat; every other refusal is untouched. The sleep is offered on every archive offer, while the flag, summary and movability dispatch stay latched on the bit actually moving.

**Evidence.** `packages/sdk/test/session-sleep.test.ts` adds `sleeps an archived session whose chat never spoke`, `sleeps a never-spoken archived session whose chat is not resumable` and `asks again after a refused archive offer, and only the move dispatches`. Without the patch no close is recorded for a never-spoken archived session, and a repeated offer issues no second sleep.

**For review.** `packages/sdk/src/host/sleep.ts` and `packages/sdk/src/host/chatactions.ts`. Two decisions: `stopping` is read off `session/isArchivedChanged`, which AHP does not define, so a caller must send a non-schema field; and the extra argument changes the public `Sleep.quiet`/`Sleep.sleep` interface.

## A sleep that throws during an archive is swallowed and the stop ends in SIGTERM

**Patch:** `patches/host-name-failed-sleep.patch` (1 commit: `e6ed994`)

**What happens today.** The archive handler queues the sleep with a catch that discards the error. A sleep that throws leaves the session resident, the stop's window runs out, the child is killed by that window, and the log holds nothing saying why. The refusal path does name the watchers that held the sleep off, so a swallowed failure reads exactly like a refusal.

**What the patch does.** The catch writes one warn line naming the session, whether it was a stop or an archive, and the reason; the reconcile that follows still runs.

**Evidence.** `packages/sdk/test/session-sleep.test.ts`, `it('names a failed sleep, and reconciles anyway')`: with a `sleep` that rejects, it asserts exactly one log line containing the session, the word `stop` and the failure's message, and that reconcile ran once. Without the patch the rejection is discarded and nothing is logged.

**For review.** Touches `packages/sdk/src/host/chatactions.ts` and the sleep test, and expects `log.warn` on the host context — the stub context in that test shows the interface it assumes. It lands on the same catch the sleep-offer ask above edits, so apply it after that one.

## There is no way to drop a session row while keeping the backend's conversation

**Patch:** `patches/host-unlist-preserves-conversation.patch` (1 commit: `2dae899`)

**What happens today.** Disposing a session drops the row and asks every backend to delete its copy, so removing a row means destroying the conversation. The drop alone would not hold: the backend still lists the conversation, so the next listing merges it back as a fresh, ownerless row.

**What the patch does.** `disposeSession` takes `preserveProviderSession: true` — the same disposal minus `deleted()` and each chat's `disposeProviderChat()`, answering `{provider, providerSessionId, directory?, chatsRemoved}` — and refuses before dropping anything: `SessionNotFound`, `session-live`, `stop-unproven`, or a mismatched `expectProviderSessionId`. An optional `SessionStore.unlisted(id)` in `unlisted.json` holds that id out of listings and `loadUnlisted` until a session is made again on it.

**Evidence.** `packages/sdk/test/session-unlist.test.ts`: `drops the row, keeps the conversation, and never asks the backend to delete it`, `stays gone after a restart, though the backend still lists the conversation`, `comes back when a session is made again on the id the unlist answered with`, and one case per refusal. Without the patch a second store over the folder lists the row again.

**For review.** Touches the five host modules in `packages/sdk/src/host/` (catalogue, history, lifecycle, sessionmethods, spawn), `packages/sdk/src/sessions/sessions.ts` and `packages/sdk/src/types/sessions.ts`. `disposeSession` now returns a value where clients expect `null`, and `preserveProviderSession` is a new option on an existing verb: both are protocol-visible. A store without `unlisted` falls back to the resurrecting listing.

## A close that throws leaves the session folder locked for the rest of the process

**Patch:** `patches/host-throwing-close-releases-folder.patch` (1 commit: `2630305`)

**What happens today.** With one writer per folder per process, `close()` released it only after the strict flush (and, for a joined store, the folder removal) succeeded. A flush that throws — a read-only folder, a failing disk — leaked it: the error reached the caller and every later store on that folder in the same process was refused as a second writer.

**What the patch does.** The flush and the removal are wrapped so the store is marked closed and the writer released in a `finally`; the error still reaches the caller. Restart cases in the tests now close the previous store before reopening, as a stopped process would, and read persisted rows from the file.

**Evidence.** `packages/sdk/test/host-close.test.ts`, `it('lets go of its folder when the last write at close fails')`: it makes the folder unwritable, expects `close()` to throw, then opens the same folder and reads a row back. Without the patch that second open throws `already has a writer`. The helper is `packages/sdk/test/support/restart-stores.ts`; a setter after close is now refused by name.

**For review.** Touches `packages/sdk/src/sessions/sessions.ts` and eight test files. It edits the release path the writer-fence ask in the next batch introduces, so it belongs after that one; against upstream today, where `close()` holds no lock, it is a no-op alone.
