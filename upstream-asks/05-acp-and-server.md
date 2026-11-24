# Upstream asks — ACP and server

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

6 issues / 9 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## A superseded ACP opening can still become the live connection

**Patch:** `patches/acp-reject-superseded-openings.patch` (2 commits: 19c3eec8, 37bceecb)

**What happens today.** `createOpening` in `packages/agent-acp/src/session/opening.ts` runs placement and the handshake in one async body and revalidates only at the end. A refresh, changed launch input or dispose during placement or `initialize` does not stop the old continuation: it resumes, becomes `ctx.live`, learns modes and options, and writes `ctx.acpSessionId` from a server nobody selected.

**What the patch does.** Installs the pending identity before the body can reach placement, captures the spawn inputs, and refuses after placement when the opening was disposed, superseded or changed. Adds `assertCurrent()` after `initialize`, after each of `session/new`, `session/load`, `session/resume` and `session/fork`, and before the handshake and the watched record. A superseded continuation throws, and teardown clears `loading`.

**Evidence.** `agent-acp-failure.test.ts` adds `discards an old placement invalidated by %s without spawning or replacing its successor` and `a late successful native $method reply cannot overwrite the selected opening after $invalidated`; `agent-acp-plugin.test.ts` adds a `failed replacement` case. With the `opening.ts` hunk reverted, the stale continuation calls `connectAcp` and replaces the selected native id.

**For review.** Touches `packages/agent-acp/src/session/opening.ts` and three test files. The microtask wrapper moves the first placement one turn after `open()`, and `loading` is now cleared even when a live connection existed. Applies to `41dcfaa0b` only; the surrounding file may have moved since.

## Advertised ACP session capabilities are written to a per-start options copy and lost

**Patch:** `patches/acp-shared-capabilities-isolated-launch-options.patch` (1 commit: 4ec4c8a2)

**What happens today.** `acpSession` projects into a per-start `options` object, and `createOpening` recorded handshake capabilities with `heardCapabilities(options, ...)`. That helper keeps them in `WeakMap`s keyed by the options object (`packages/agent-acp/src/catalog.ts`), while `deletes()` and `forks()` read through the object the catalog holds. With isolated launch options the key is the copy, so `session/delete` and `session/fork` look unadvertised.

**What the patch does.** Passes the shared options into `createOpening` as `capabilityOwner` and records capabilities there, leaving launch options per start. It also rethrows an opening authentication failure with its protocol code and data intact, but with the corrective method names a later prompt failure reports.

**Evidence.** `agent-acp-delete.test.ts` `forgets a session this process watched, so the next listing does not offer it` (now `--no-load --no-list`); `agent-acp-signin.test.ts` `refuses a session from a server nobody signed in, naming the methods it offers` (asserts `authRequired` on the rejected open); `agent-acp-catalog.test.ts` no-rollout resume and `refuses a fork at a turn the server was never offered one for`.

**For review.** Touches `packages/agent-acp/src/session.ts`, `session/opening.ts` and eight tests. Expectations add `sessionIdEnv` and `spawnGuard` to `hostOnly`; the `project()` path reserves `HAB_ACP_PID_PREFIX`, `HAB_ACP_SESSION_URI` and `HAB_ACP_CHAT_URI` — deployment names with no upstream equivalent, where the generic form is a deployment-named identity variable rather than a fixed `HAB_` prefix. It also assumes earlier projection and eager-opening work, so it will not apply to `41dcfaa0b` alone.

## An ACP server's `_meta` on its opening reply never reaches the session state

**Patch:** `patches/acp-opening-meta-session-state.patch` (1 commit: 861b3430)

**Status: waits on protocol.** This goes upstream as an AHP schema proposal first — `_meta` on the opening reply. The code follows only if the schema is accepted; until then it stays a fork patch (@cto, 2026-11-24).

**What happens today.** Answers to `session/new`, `session/load`, `session/resume` and `session/fork` may carry `_meta`. A bridge that resumed a transcript it already held on `session/new` says so there, and a client moving a conversation onto the host has that as its only proof the move carried. `createOpening` kept only `sessionId`, modes, models and config options, so `_meta` never reached `sessionState()`.

**What the patch does.** Adds `openedMeta`, reads `_meta` from whichever reply opened the conversation (`openedMetaOf` accepts only a plain object), and serves a structured clone on the session state. A server that said nothing yields none.

**Evidence.** `agent-acp-catalog.test.ts` adds `passes the _meta the server answered opening the conversation through on the session state`, asserting it for `session/new` and `session/load` and `undefined` for a silent server; the fixture gains `--says-meta`. With the source hunks reverted, all three assertions see `undefined`.

**For review.** Touches `packages/agent-acp/src/session.ts`, `session/context.ts`, `session/opening.ts`, one test and `test/fixtures/acp-server.mjs`. Untouched cloned `_meta` means arbitrary server payloads reach every client, and a non-object `_meta` is silently dropped — a warning may be warranted. The new fixture docblock sits between an existing one and its declaration, so `about` loses its comment.

## An unreadable record file is served as absent, and a partial listing looks complete

**Patch:** `patches/acp-preserve-records-read-failures.patch` (2 commits: 7ee8395a, 863a43a8)

**What happens today.** In `packages/server/src/records.ts`, `textOf` swallowed every read error as absent, `recordIn` returned `undefined` on a parse or id mismatch, the first load skipped the file, and `reread` returned early. `get` answered `undefined`, `list` and `find` omitted it, and a `deleted` change could be told while the file remained.

**What the patch does.** Re-throws anything but `ENOENT`. `recordIn` throws a content-free error naming the collection and file. A failed first load rejects `collection(...)`, legacy `.json` conversion included. A watched failure over a known-good record keeps the cache; with none, `get` for that id, `list` and `find` reject until a reread or real deletion clears it. Ids come from directory names, so a broken file is observed.

**Evidence.** `packages/server/test/records.test.ts` adds `describe.each(['md','json','folder'])('record read failures (%s)')` with `rejects a %s first load instead of opening an incomplete collection`, `rejects an unreadable first load and retains a known-good record after a watched read failure`, `refuses incomplete reads for an unknown failed record, then recovers only after repair or real deletion`; `plugin-records.test.ts` adds `propagates a failed backend open to plugin reads and writes, and retries after repair`.

**For review.** Touches `packages/server/src/records.ts`, `packages/server/test/records.test.ts` and `packages/sdk/test/plugin-records.test.ts`. `list()` can now throw and one corrupt file stops a collection opening, so consumers assuming a total list need auditing. Parser text is gone, so debugging means opening the file.

## A never-prompted ACP conversation cannot be recovered without proof it was never spoken

**Patch:** `patches/acp-recover-proven-unspoken.patch` (1 commit: 920ffefc)

**What happens today.** When a backend conversation has no materialised rollout — Codex answers `-32603` "no rollout found for thread id …" — the host cannot tell "never spoken" from "transcript gone". A `session/load` or `session/resume` for such a thread fails the opening, and recovering it by starting fresh would be indistinguishable from replacing one that held words, so nothing recovers it.

**What the patch does.** Adds `isNoRollout` (`-32603` plus the exact id), a `neverSpoken` flag through `Start`, `StoredChat` and `SessionAt`, a `beforePrompt(backendId)` hook that commits the native binding and consumes provenance before dispatch, and a strict `SessionStore.flush()`. Fallback to `session/new` needs a flushed store, the original conversation, provenance true and a matching backend id, before the first prompt.

**Evidence.** `agent-acp-catalog.test.ts` `uses positive no-rollout provenance for an ephemeral read and only the first provider prompt`; `packages/sdk/test/sessions.test.ts` `retains explicit never-spoken provenance %s across a cold store`, `keeps failed native-binding and provenance writes pending until a strict flush commits them`, `does not manufacture provenance from historical or invalid value %s`. Without the fallback, the load rejects `-32603` and the first turn ends `chat/error`.

**For review.** Spans `packages/agent-acp/src/{agent,catalog,session}.ts`, `session/{context,opening,turn}.ts`, `packages/sdk/src/host/{chatrecord,localturns,spawn}.ts`, `sessions/sessions.ts` and `types/{agent,sessions}.ts`. `flush()` and `promptStart` are new public surface; a store without `flush` never qualifies. `save()` no longer clears `dirty` eagerly, so failed writes stay pending and `close()` can throw.

## A host listing server that dies before its handshake is respawned on every read

**Patch:** `patches/server-bounded-backoff-respawn.patch` (2 commits: dec3c142, 64ddcd26)

**What happens today.** `catalogueOf` stops retrying a failed host listing only for records without sessions. Records that keep sessions rethrow and is re-asked every pass, so a server dying before `initialize` is spawned each time; the other path stopped permanently on stale rows.

**What the patch does.** Replaces both with one `hostRetry` keyed by spawn inputs (command, args, cwd, env), doubling one to fifteen minutes. No-session records wait after any failure and answer from watched rows; session-keeping records wait only after a pre-handshake death and answer with it.

**Evidence.** `agent-acp-failure.test.ts` adds `logs one line, not one per pass, for a record that keeps sessions and whose env file is gone` and `spawns a died-before-handshake host server again only after a doubling wait, at once on a changed input, and resets on an answer`, and rewrites `answers the watched rows after a listing whose command is missing, with one line, and tries again after the wait`; `agent-acp-machines.test.ts` renames it to `answers the watched rows after a host listing fails, with one line, until the wait is over or its record changes`.

**For review.** Touches `packages/agent-acp/src/catalog.ts` and two tests. Waits are wall-clock, pinned by `Date.now` mocks; a deployment can serve stale rows or a stale failure for fifteen minutes. A `WeakMap` keyed by options identity restarts a recreated record at one minute.
