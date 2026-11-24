# Upstream asks — host session store

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

4 issues / 9 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## An ACP turn whose first-prompt barrier fails keeps its open session for retry

**Patch:** `patches/host-retain-unprompted-sessions.patch` (1 commit: `9ac18c25`)

**What happens today.** In `packages/agent-acp/src/session/turn.ts` the turn calls the host's `beforePrompt` callback, then the provider's `prompt`. A host that throws there - a durable write refusing the native conversation id - is caught by the turn's outer handler, which reads it as the ACP server failing: it clears `ctx.opening`, unsets `ctx.live` and closes the connection. The turn does end as `sendFailed`, but the native session already opened is discarded, so a retry spawns a new server and never retries the barrier against the session it was refused for.

**What the patch does.** Guards that one call. A refusal ends the turn as `sendFailed` from there and leaves `opening`, `live`, `neverSpoken` and `prompted` alone, so the next turn re-enters the same open session at the same native id.

**Evidence.** `packages/agent-acp/test/agent-acp-catalog.test.ts`, "dispatches no provider prompt before a failed durable barrier can be retried": the callback throws on the first turn and succeeds on the second, which must dispatch exactly one `session/prompt` at the same agent id, with one `session/new` in total. Without the patch the retry re-opens instead.

**For review.** `packages/agent-acp/src/session/turn.ts`, plus cases in `packages/sdk/test/host-chats.test.ts` and `nested-proxy.test.ts`. The guard assumes `Start.beforePrompt`/`neverSpoken` and `SessionStore.flush()` from a companion series, so it is not standalone. Worth your ruling: a host refusal still reads as `sendFailed`, indistinguishable on the wire from a dying server.

## A session store commit is synchronous, and an unreadable row stays an error

**Patch:** `patches/host-store-commit-strictness.patch` (4 commits: `a49d8265`, `8356a8b4`, `1abc6c18`, `4f4b15d3`)

**What happens today.** `fileSessions()` coalesces writes onto the next tick, reports a failure only through `onProblem`, and clears the pending set before writing, so a failed row is never retried. A file that cannot be read is moved aside and answered as an absent session, so an archived session quietly becomes active again. A plugin's `named` callback that throws is logged and the start proceeds.

**What the patch does.** Adds `commit(id)`, which writes that row, rejects on failure and keeps it pending for a retry. Malformed, unsupported-version and mismatched rows stay addressable as errors while siblings load, and an unreadable directory throws. `named` is awaited, so a caller that cannot record the URI refuses creation before a backend exists.

**Evidence.** `packages/sdk/test/sessions.test.ts`: "reports background write failure and strictly commits the same pending row after repair", "keeps an unreadable session addressable without replacing its bytes: %s", "preserves an OS-unreadable row as an error rather than an absent session", "refuses a write over an unreadable row and preserves its only bytes"; `plugin-start-session.test.ts`: "awaits the mapping callback before the backend spawns". Without it, `setFlags` returns over an unwritable path, logs the failure, and the row is dropped.

**For review.** `packages/sdk/src/{sessions/sessions.ts,types/sessions.ts,host/automations.ts}`, `docs/sdk/AHP.md`, `docs/plugins/PLUGINS.md`. Policy, not just interface: a bad row is now an error every client meets, and a required method breaks third-party adapters. `commit(id)` becomes async only in the last commit.

## A session's creation request is durable before its backend starts

**Patch:** `patches/host-owned-creation-intent.patch` (2 commits: `22a3b0bc`, `5b1bdc0e`)

**What happens today.** A plugin or automation start tells its caller the URI through `named` and only then walks admission, plugin copies, the tree and the backend. Nothing records what was asked for: prompt, model selection, instructions and captured plugins live only in memory, so a start that fails after naming cannot be recognised or finished later.

**What the patch does.** Adds `SessionCreation` - `phase` reserved/admitted/complete, `initialPrompt` none/pending/admitted/settled, plus instructions, customizations, model and prompt - and the required `creation`/`setCreation` pair on the store, keeping owner, provider, config, title, folder and the default chat in their ordinary fields. `createProviderSession` gains `beforeCreate`; a start commits a detached snapshot as `reserved`, calls `named`, commits `admitted`, then creates the backend. A failed start no longer forgets a row that holds creation intent.

**Evidence.** `packages/sdk/test/sessions.test.ts`, "commits creation admission and missing request facts in the existing session row" (values survive a template mutation and a restart). In `plugin-start-session.test.ts` the naming test now reads the row from disk inside `named`, asserting `reserved`, then `admitted` at create, then `complete`; `('starts no backend when the %s row commit fails')` covers the barrier, for both phases.

**For review.** `packages/sdk/src/{index.ts,sessions/sessions.ts,types/sessions.ts,host/automations.ts,host/lifecycle.ts}`. Builds on `commit(id)`. Two judgement calls: a config that does not survive a JSON round trip is refused with `invalidParams`, and the required methods are another breaking change for adapters.

## A reserved session answers its owner, and its owner can resume it

**Patch:** `patches/host-reserved-ownership-run-session-exclusive.patch` (2 commits: `c47099fa`, `7ec7b532`)

**What happens today.** `sessionOwner(uri)` answers only where the live catalogue can still open the session, so a reservation whose `named` callback rejected reads as absent and a plugin starts a second session instead of finishing the first. `startSession` always mints a new URI, so that reservation is unreachable.

**What the patch does.** A durable reservation answers its saved owner at its exact canonical URI without probing history, admitting it or starting a provider, and rejects a missing canonical URI. `startSession({ owner, resume })` reuses it: checking URI and owner, rebuilding the saved request, default chat, folder and title, under a per-session exclusive lock shared with creation and worktree lifecycle. It never remints the URI or replays an admitted prompt, and refuses a naming callback that awaits a resume of its own session.

**Evidence.** `packages/sdk/test/plugin-session-owner.test.ts`, "answers the reserved owner after mapping rejection without opening the backend" (backend reads and queries unchanged, phase still `reserved`). `plugin-start-session.test.ts`: "resumes the same reservation after a lost mapping acknowledgment", "serializes two recoverers behind the original naming callback", "rejects a naming callback awaiting its own reservation resume". Without the patch the first answers nothing.

**For review.** `packages/sdk/src/{plugins/plugins.ts,plugins/validate.ts,host/automations.ts,host/lifecycle.ts,types/plugin.ts,types/automations.ts}`. `lifecycle` grows `runSessionExclusive`/`inSessionExclusive` over `AsyncLocalStorage`, and worktree removal now logs a rejected chain rather than dropping it. The lock deserves the closest read: `inSessionExclusive` must stay a refusal, not a wait.
