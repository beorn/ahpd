# Patches this fork carries over upstream

Seeded 2026-11-24 from #38158 (@dev/6, per @cto 193269b5 / b443133f); completed 2026-11-24 by
@dev/1 from the 70-patch rebase census (#38120).

This list measures the operator's "zero patches" target. One line is one patch carried on
`hh/integration` over `upstream/main` (ahpio/ahpd): commit(s) · what · why (issue) · upstream status.

Upstream status is one of:
- `PR pending card` — upstream text is ready and is posted only on the operator's upstream card;
- `posted <url>` — an upstream PR exists;
- `not upstreamable: <reason>` — the change exists only for our fork, with the reason;
- `upstream ask not written` — checked and absent upstream, plausibly upstreamable, but nobody has
  written the ask yet (the remaining work on the zero-patch target).

## What was measured (2026-11-24, @dev/1)

- measured on `origin/hh/integration` at `adcbeece7` (the tip before #38158's `535303cf5` landed), 70 non-merge patches over `upstream/main` `41dcfaa0b`
  (merge-base `e5776651`), plus 13 merge commits. 82 commits ahead, 436 behind.
- **0 of 70 are upstream already.** `git cherry upstream/main` is `+` for all 70 (no patch-id
  match), and no upstream commit names the issues this stack carries (34599, 34945, 35117, 35154,
  37250, 37272, 37426, 37472, 37577, 37603, 37753 — zero hits).
- Each row below was also checked by symbol: the identifiers the patch introduces are absent from
  `upstream/main` (`custodyRecord`, `CustodyState`, `HAB_ACP_HOST_SERVICE_IDENTITY`, `spawnGuard`,
  `settleInitialPrompt`, `initialPromptTurns`, `tryAcquireFlock`, `serviceIdentityEnvironment`,
  `AppendJsonlOptions`, `successfulOpening`, `openedMeta`, `joinedSessionIds`, `unlistedIds`,
  `preserveProviderSession`, `heldAgentTurns`, `listedFolder`, `HOST_RETRY_FIRST_MS`,
  `stoppingChats`, `runSessionExclusive` — all absent). `createOnly` exists upstream only in the
  bot/computer packages, not in `records`.
- One behavioural twin was checked and rejected: upstream `93b232b89` "a turn the host ends settles
  its automation run" settles an *automation run*; ours (`af158c8b1`) settles the *initial prompt*
  durably and does not exist upstream.
- Rebase: `dev1/ahpd-catchup` replays all 70 plus 4 repair commits (`fix: repair three merge
  defects left by the upstream rebase`, `fix: one overrides map in pnpm-workspace.yaml…`,
  `fix(server): take @bearly/durable-file from the registry build…`, `fix(agent-acp): one
  @bearly/durable-file, 0.2.0, for the whole tree`) and `fix(acp,test): settle rebase conflicts of
  intent and two waits that raced our slower start`. The repairs are rebase artefacts, not
  behaviour; they are not counted as patches.

## Patches

### Host: chat binding and conversation provenance
- `84441da3c`, `2ab6dcb47`, `a8bc5f407`, `99935dd5b` · persist the backend chat binding before the first prompt, keep the eager backend identity, and keep a created session's harness and folder before its first binding is saved · #34945 · upstream ask not written (generic host ordering bug; no ask prepared)
- `daa329f08`, `46db0cb63`, `5e9bb697c` · chat conversation provenance is persisted with the session, projected by the host at startup, and preserved across the chat lifecycle · #32996 (context; no issue names this patch) · upstream ask not written (the `sessionConversation` type is generic)

### Host: session store, owned creation and reservations
- `9ac18c25b` · retain unprompted sessions across persistence retries · #35117 · upstream ask not written
- `a49d82650`, `8356a8b47`, `1abc6c182`, `4f4b15d3d` · await the mapping callback before starting sessions, commit pending store changes strictly, preserve unreadable rows as errors, and acknowledge commits for the requested row · #35139 · upstream ask not written
- `22a3b0bcd`, `5b1bdc0e7` · persist owned creation intent in the session row and commit owned creation before mapping and backend start · #35139 · upstream ask not written
- `c47099fa1`, `7ec7b5321` · read reserved ownership without restoring, and resume owned reservations on the existing session lifecycle (`runSessionExclusive`) · #35139 · upstream ask not written (largest conflict: upstream rewrote the same block into a worktree-removal queue)
- `9bc824b77`, `edc4189dd` · fence file-store writers across accepted host starts, and close them before cold-restart assertions · #35139 · upstream ask not written (wip step plus its test; ships as one patch)

### Host: prompt settlement, sleep and stop window
- `eb5b5e402`, `af158c8b1` · durably settle the exact initial prompt (red test plus fix) · #35139 · upstream ask not written (upstream `93b232b89` settles an automation run, not the prompt)
- `9f1716148`, `8c1632147`, `e1b7097f2` · sleep an archived or never-spoken chat whose session is not resumable, and ask for the sleep on every archive offer · #37426 · upstream ask not written
- `e6ed9944d` · name a failed sleep instead of swallowing it · #37577 · upstream ask not written
- `2dae899b5` · an unlist drops the row and preserves the provider conversation · #37603 · upstream ask not written
- `26303059d` · a throwing close still releases the session folder; restart cases release the old store · #37472 · upstream ask not written

### Host: turn, join and catalogue
- `3c0500e36` · stamp `turnId` on chatInput requests and fence the post-abort unwind across host, agent-acp, agent-claude and agent-cofold · #35154 · upstream ask not written (`heldAgentTurns`/`agentTurnId` absent upstream)
- `d0e6bf9b5`, `2453628ee`, `e107907ed` · scope nested child sessions by hub and inner id, dispose joined sessions from their durable scope, with the two-host test · #37250 · upstream ask not written (`joinedSessionIds` absent upstream)
- `780688f0f` · avoid duplicate provider assignments and track fork identity honestly · #34955 · upstream ask not written
- `adcbeece7` · list each record's own folder so a same-account thread is not credited to another record · no issue filed (context #32996) · upstream ask not written
- `c6f74e9d0` · agent-acp marks and reports the turns an agent starts itself; an update outside every turn is counted and warned, never dropped silently · #38159 · posted https://github.com/ahpio/ahpd/pull/462 (2026-11-24, operator D292; beorn fix/updates-outside-a-turn-r6, rebased on upstream 7d927326c)

### acp: openings, native identity and custody
- `19c3eec8a`, `37bceecb9` · reject superseded asynchronous openings before spawn, and discard obsolete native replies before changing opening state · #32996 · upstream ask not written
- `0f5066257`, `ba2b264b8`, `e6d0fde75`, `710f46432` · publish selected child custody before initialize, clear the owned stat after a partial publication, with the catalog-exclusion and cleanup tests · #34599 · not upstreamable as written: the custody record is keyed on `HAB_ACP_PID_PREFIX`/`HAB_ACP_SESSION_URI`/`HAB_ACP_CHAT_URI`, which hab sets for the child it launches; the underlying early-publication bug is upstreamable against upstream's own identity
- `3400a70d0`, `1d14f2ce8`, `322b91d98`, `e5fb82b7a` · project only the current successful native chat identity, checkpoint it per start, and preserve identity capabilities and opening failures · #32996 · not upstreamable as written: same `HAB_ACP_*` protocol (`successfulOpening` absent upstream)
- `4ec4c8a2f` · retain shared capabilities with isolated launch options · #32996 · upstream ask not written
- `accd216d6`, `e9a357c66`, `109fb842c`, `11d020247` · a host-owned custody record kept through the child's end under one per-seat lock, carrying the verified host service identity · #34599 · not upstreamable as written: `HAB_ACP_*` lock and `HAB_ACP_HOST_SERVICE_IDENTITY`; the per-seat lock is hab's seat model
- `9063cd7ae`, `0321cd8b1`, `ce669d44b` · retain inherited occurrence custody across host crashes, reject guard overrides and verify escaped child custody, and keep retained plugin resumes off probe authority · #34599 · not upstreamable as written: the spawn guard is `HAB_ACP_SPAWN_GUARD`, a hab-launched child protocol upstream does not have
- `861b34309` · pass the server's opening `_meta` through on the session state · #37272 · upstream ask not written (`openedMeta` absent upstream)

### acp / server: failure handling and retries
- `7ee8395a9`, `863a43a85` · preserve records read failures across open and watch, and keep unknown and spoken no-rollout errors · #35127 · upstream ask not written
- `920ffefcc` · recover only proven unspoken conversations before their first prompt · #35117 · upstream ask not written (`neverSpoken` absent upstream)
- `dec3c1424`, `64ddcd26b` · one bounded backoff policy for respawning a host server and for `failedOnHost` listings · #37753 · upstream ask not written

### Records: exclusive creation
- `9b4d713d0`, `7c8074aeb`, `d7d038c2d` · arbitrate create-only record creation on disk with an exclusive lock, with the cross-process proof · #35139 · upstream ask not written (`tryAcquireFlock` absent upstream; upstream `createOnly` is an unrelated bot option)

### Plugins: service identity
- `88f113085`, `379acf190` · delegate plugin service identity to exact source bindings, and prove record refs cannot recover the startup credential · #35090 · not upstreamable: reads `HAB_ID_TOKEN_FILE`/`AHPD_SERVICE_TOKEN_FILE`, the token files hab writes; `serviceIdentityEnvironment` does not exist upstream

### Test infrastructure
- `0535e7929`, `bb37b23c8` · detect checkout Git mutations during ahpd tests, and isolate ahpd workspaces from ancestor Git discovery · #37182 · upstream ask not written (tests only; `AHPD_TEST_REPOSITORY` absent upstream)

### usage: inhab JSONL source
- `31d558b65`, `2a73aba1b`, `ab933f119`, `f3f3f3937`, `0ac4f15c2` · re-derive the usage JSONL append source from Ag (three provenance pins), preserve the zero-tail repair, and re-read the append boundary so a later record is never glued to a zero tail · #35067, #33944 · not upstreamable: reads hh's inhab JSONL journals and pins an Ag commit (`inhab-jsonl.provenance.json`), a format upstream does not have

### Services: machine-local switches
- `67799d139` · `@ahpd/services` `machineSwitches(configDir)`: allowRemoteCommands and allowRoomAsks under a `machine` key in config.json that root config does not serve · #38277 (@cto 8033ccb4) · upstream ask not written (new package; the process-compose driver follows in the same package)
- `1a7e8f52b`, `6e6f65762` · `@ahpd/services` process-compose driver: `listServices`/`putService`/`removeService`/`controlService`/`serviceLogs`; last `-f` file only, sha256 ifVersion, range-splice edits, read-only rules, 0600 change log, reload over the Unix socket · #38277 slice 1 (@cto) · upstream ask not written (new package)

### Superseded
- `d17130bbf` · remove per-turn git checkpoint capture, keeping `removeCheckpoints` · #35139 · superseded by `535303cf5` (#38158, PR pending card: an unreferenced in-memory baseline tree; no baseline reads unknown, never 0)

## PR prepared (not carried)

Upstream fixes written straight against `upstream/main` and never carried on `hh/integration`. They
are not in the patch count; each waits for the operator's upstream card.

- `92afb94db` on `fix/acp-backend-start-fails-creation` (base `upstream/main` `7d927326c`) · a
  backend that cannot start fails session creation: opt-in `Session.sendBringsUp`, agent-acp's send
  resolves once its server holds the session and rejects naming the command, its PATH and a capped
  stderr tail · #38139 (@cto b1d6a0cf, amendment OK 491ba7d9) · PR pending card (text:
  /hh/var/@dev12/38139-upstream/PR.md); carried on `hh/integration` only if a live seat needs it
  before upstream answers

## What is left on the zero-patch target

Measured over the 70 patches:

- 1 has an upstream PR posted (#38159, `c6f74e9d0`, ahpio/ahpd#462, 2026-11-24);
- 1 is superseded (`d17130bbf`, replaced by #38158's `535303cf5`, whose text is also a
  `PR pending card` and which is not counted in the 70 because it is not on `hh/integration` yet);
- 22 are not upstreamable as written, all for one of two reasons: they speak hab's `HAB_ACP_*` /
  `HAB_ID_TOKEN_FILE` child protocol (17), or they read hh's inhab JSONL journals pinned to an Ag
  commit (5);
- 46 are absent upstream with no ask written — the real remaining work on the zero-patch target.

The honest shape of the target is therefore: 46 upstream asks plus the 1 prepared, and a decision on
the 22 fork-protocol patches, which stay ours unless upstream grows hab's protocol.
