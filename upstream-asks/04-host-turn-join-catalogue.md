# Upstream asks — host turn ids, join scope and store writers

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

5 issues / 8 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## A late input request from an aborted turn is raised against the turn that replaced it

**Patch:** `patches/host-turn-id-fence.patch` (1 commit: `3c0500e`)

**What happens today.** `chat/inputRequested` names no turn, so an elicitation emitted while an aborted prompt unwinds has nothing to attribute it to. Once a successor has started, the host passes the request on and the catalogue raises the `session/inputNeededSet` entry under that turn: a client waits on an answer that belonged to a turn nobody is running.

**What the patch does.** The ACP, Claude, cofold and bot adapters stamp the turn id on every `chat/inputRequested`. The host drops a request whose turn id is not the active turn, or that arrives with none, and remembers which turn asked so the catalogue carries `turnId` only when it matches. ACP also answers one with `cancelled` once its turn was cancelled or replaced.

**Evidence.** `packages/agent-acp/test/agent-acp-ports.test.ts`, `refuses a late elicitation and permission emitted during post-abort prompt unwind so a queued successor turn runs`; `packages/sdk/test/host-input-needed.test.ts`, `drops a stale chat/inputRequested from an ended or superseded turn when activeTurn is undefined or a successor`. Without the patch the late request is dispatched and its entry lands on the successor turn.

**For review.** Neither `ChatInputRequestedAction` nor `SessionChatInputRequest` has `turnId` in AHP v1, and the patch adds it by hand in `tools/schema.mjs`; a strict client would reject the field, so the protocol likely needs it first. Touches `packages/agent-acp/src/session/handlers.ts`, `packages/agent-claude/src/session/asking.ts`, `packages/agent-cofold/src/mapping.ts`, `packages/bot/src/chat.ts` and the sdk host (`host.ts`, `host/asking.ts`, `host/catalogue.ts`, `host/context.ts`).

## Two session hosts joined to one node share a session store

**Patch:** `patches/host-join-scope-durable.patch` (3 commits: `d0e6bf9`, `2453628`, `e107907`)

**What happens today.** Every session host a joined node opens starts in the same workdir on the same sessions directory, so two live hosts write over one another's rows; disposing from one can retire state another uses, and a child can pick up a leftover legacy row.

**What the patch does.** `node/open` carries a scope of hub identity and inner session id, passed in the child's environment. The store then lives at `sessions/nested/<sha256 of both ids>` with an `identity` file verified on reopen; an id still in the legacy shared store is refused by name before opening a socket; disposing the scoped session retires its folder; and a nested delete disposes by durable id.

**Evidence.** `packages/server/test/join.test.ts`, `serves two live session hosts on the same joined node` (red first in `d0e6bf9`) and `names the legacy shared store on the control request and leaves its row intact`; `packages/sdk/test/sessions.test.ts`, `disposes the joined scope from its durable record when the backend cannot list it`. Without the patch the second open lands in the first host's directory.

**For review.** Adds `packages/server/src/joined-session.ts`, `packages/server/src/commands/{join,run}.ts`, a `scope` field on `node/open`, `AHPD_JOINED_SESSION` as the parent-to-child contract, `hostId` on `liveNodes` (`packages/sdk/src/nodes.ts`), and `packages/sdk/src/sessions/{sessions,nested}.ts`. The layout is durable: the hash must stay stable, and every host opening a nested store must know the scope.

## A fork is recorded under a transcript id before its backend has named one

**Patch:** `patches/host-duplicate-provider-assignments.patch` (1 commit: `780688f`)

**What happens today.** Recording a session writes the provider for the session and again for the id the backend reports as its own transcript. A fork inherits its source chat's turns, so a backend that names its transcript only when its own turn completes reports an id as soon as the fork exists, and the row is written under a transcript id the backend has not chosen; every later turn also re-writes the unchanged provider row.

**What the patch does.** Both writes are skipped when the stored provider already equals the one being recorded, and the fork fixture now reports its transcript id only after its own turn completes.

**Evidence.** `packages/sdk/test/session-provider.test.ts`: `records a fork under its own id once the first turn that names it ends` shows the early capture on a late-naming fixture, and `records the transcript id once, and writes nothing on the turns after` asserts a counting store sees exactly `['plain', 'own-plain']` across two turns. Without the patch the second turn adds another write.

**For review.** Touches `packages/sdk/src/host/spawn.ts` only, in `recordSessionProvider`, plus its test. Check one consequence: a provider recorded wrongly by an earlier release is no longer corrected on the next start, because the guard now trusts the stored value, so a correction path needs naming if that matters.

## A session listing asks each backend about every folder, crediting a thread to the wrong record

**Patch:** `patches/host-list-record-own-folder.patch` (1 commit: `adcbeec`)

**What happens today.** For a backend where one account keeps every conversation in one store, `session/list` was asked about no folder, so each record listed every thread. The host gives an unrecorded id to the first agent listing, so a thread made in one record's folder is credited to another, and resuming it there is refused.

**What the patch does.** When a record names an absolute folder and runs on this host, the listing passes it as ACP's `cwd` filter; no folder, a relative one, or a server in a machine still asks about none. `find` now takes the host's recorded folder and lists it on the record's server when it differs, without which a worktree session would drop out.

**Evidence.** `packages/agent-acp/test/agent-acp-listing-cwd.test.ts`, `credits a thread to the record of the folder it ran in, not to the first record on its account`, whose second case keeps a session recorded outside either folder listed; `agent-acp-catalog.test.ts` replaces `lists every session the server holds, whatever folder the server runs in` with the filtered case. Without the patch the first-loaded record takes both threads.

**For review.** Touches `packages/agent-acp/src/{agent,catalog}.ts`, two tests and the ACP fixture. It changes what a record lists wherever the backend honours `cwd`: rows seen only unfiltered vanish unless recorded, and the fallback costs an extra `session/list`. Confirm servers honour `cwd`.

## Two hosts in one process can open the same session folder and write over each other

**Patch:** `patches/host-fence-file-store-writers.patch` (2 commits: `9bc824b`, `edc4189`)

**What happens today.** The file store takes no lock. Two stores over one folder — a restarted host that never stopped the old one, two hosts on one directory — both write rows, neither sees the other's deletes, and a closed store still takes setters and writes nothing.

**What the patch does.** Opening takes an `flock` beside the folder (`@bearly/flock`); a second open, same process or not, throws `already has a writer`. Every mutation goes through `owned()`, which re-reads the lock's inode, device and folder path; `close()` flushes strictly and releases; a setter after close throws by name. The second commit moves the tests' restart cases onto a helper that closes the previous store first.

**Evidence.** `packages/sdk/test/sessions.test.ts`, `holds the file-store writer across OS processes until close` (a child exits 73 with `already has a writer`, then succeeds once the parent closes) and `rejects a closed file-store setter before changing its retained row`. Without the patch the child opens the folder and reads the row.

**For review.** Carries platform policy that should not go upstream as written: `package.json` gains `"os": ["linux", "darwin"]`, engines move to `node >= 24` and `bun >= 1.3.13`, and the READMEs drop Windows, Node 22 and Deno, which the project advertises; the lock also needs a Windows story. Touches `packages/sdk/src/sessions/sessions.ts`, `packages/sdk/src/host{.ts,/lifecycle.ts}` and every workspace manifest plus `pnpm-lock.yaml`.
