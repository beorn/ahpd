# Patches this fork carries over upstream

Seeded 2026-11-24 from #38158 (@dev/6, per @cto 193269b5 / b443133f); completed 2026-11-24 by
@dev/1 from the 70-patch rebase census (#38120).

This list measures the operator's "zero patches" target. One line is one patch carried on
beorn `main` over `upstream/main` (ahpio/ahpd): commit(s) · what · why (issue) · upstream status.

Moved from `hh/integration` to `main` on 2026-11-25 by @dev/6 (@cto 882d5e88): `main` is the release line, so the
list of what we carry lives here. Every row names commits on `main`. A row whose change is still only on
`hh/integration` says `not on main: <sha>, awaiting its author's PR` and is not counted as carried. A patch that
reached `main` under a different hash names the `main` commit, with the `hh/integration` one after it.
`hh/integration` is retired by its owner under the branch-cleanup rule once no commit of it is missing from `main`.

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

### Re-measured 2026-11-25 (@dev/1, #38436 first pass)

- measured on `origin/main` at `8b2925b18` over `upstream/main` `ca66aafab`: **108 non-merge
  commits carried, 0 upstream-equivalent** (`git cherry upstream/main origin/main` is `+` for all
  108), so this pass offers no drop: nothing we carry has reached upstream by patch-id.
- 100 shas were already named here. The 29 whose change had no row are added below.
- Of the 16 named shas that are not ancestors of `main`, 9 are hh/integration twins already paired
  with their main commit on the row itself; the rest are the five #38233 commits, `c6f74e9d0` and
  `535303cf5`, each already marked awaiting its author's PR.
- 3 more hh/integration-only fixups had no row and landed in this pass: `7eb7aae9a` with the #38233
  row (PR #22), `173a6ff76` and `c24cccacf` under Rebase repairs and test-only fixups (PR #24).
- The 29 newly rowed commits split 24 `upstream ask not written` and 5 `not upstreamable` (2 of them
  the users-read census harness, 3 our own process and ledger docs). No new upstream card is implied.
- Re-measured 2026-11-26 (@dev/4, #38436): 190 carried over upstream/main `1f3168c22` (origin/main `7b49d0cbb`, 0
  upstream-equivalent); 74 had no row and are now rowed, in 30 rows: 25 `upstream ask not written`, 47 `not upstreamable`
  (our customer-host install, deploy driver, release builder, the Hightea services package, our own docs), and 2 `posted`
  (plugin channel operations, ahpio/ahpd#474, which upstream carries under its own hash). A row naming a PR merge commit
  counts that merge's `^1..^2` commits as rowed.

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
- `e8f95e2e4` · opening the file store creates only the lock's folder, not `sessions/`, so a refused legacy `sessions.json` is left alone · #38634 · upstream ask not written (fixes our writer fence `9bc824b77`; goes with that row's ask)

### Host: prompt settlement, sleep and stop window
- `eb5b5e402`, `af158c8b1` · durably settle the exact initial prompt (red test plus fix) · #35139 · upstream ask not written (upstream `93b232b89` settles an automation run, not the prompt)
- `9f1716148`, `8c1632147`, `e1b7097f2` · sleep an archived or never-spoken chat whose session is not resumable, and ask for the sleep on every archive offer · #37426 · upstream ask not written
- `e6ed9944d` · name a failed sleep instead of swallowing it · #37577 · upstream ask not written
- `2dae899b5` · an unlist drops the row and preserves the provider conversation · #37603 · upstream ask not written
- `26303059d` · a throwing close still releases the session folder; restart cases release the old store · #37472 · upstream ask not written
- `39f5cc389` · turning an agent off sleeps each of its sessions (`stopWhenQuiet`; a running turn finishes first), never removes them · no issue · upstream ask not written (`stopWhenQuiet` absent upstream; upstream's disable only writes `mode: disabled`)

### Host: turn, join and catalogue
- `3c0500e36` · stamp `turnId` on chatInput requests and fence the post-abort unwind across host, agent-acp, agent-claude and agent-cofold · #35154 · upstream ask not written (`heldAgentTurns`/`agentTurnId` absent upstream)
- `d0e6bf9b5`, `2453628ee`, `e107907ed` · scope nested child sessions by hub and inner id, dispose joined sessions from their durable scope, with the two-host test · #37250 · upstream ask not written (`joinedSessionIds` absent upstream)
- `780688f0f` · avoid duplicate provider assignments and track fork identity honestly · #34955 · upstream ask not written
- `adcbeece7` · list each record's own folder so a same-account thread is not credited to another record · no issue filed (context #32996) · upstream ask not written
- not on main: `c6f74e9d0`, awaiting its author's PR · agent-acp marks and reports the turns an agent starts itself; an update outside every turn is counted and warned, never dropped silently · #38159 · posted https://github.com/ahpio/ahpd/pull/462 (2026-11-24, operator D292; beorn fix/updates-outside-a-turn-r6, rebased on upstream 7d927326c)
- not on main: `27f6093df`, `c46e0acf0`, awaiting their author's PR · a listed row two harnesses read that no record names is nobody's; the agent its opening caller names claims it, and an open that refuses puts the row back nobody's · #38259 · upstream ask not written (the guess is the catalogue's own fallback, absent upstream only as a behaviour: no ask is prepared yet)
- `f3e4911f1` · each open tool call carries its own silence bound (900 s by default, per-call timers, the turn ended naming the call, its open age, its silence and the bound) · #38695 (@cto fb984750) · upstream ask not written (the disarm it replaces is fork-only, #38786 `tools.size > 0`, absent upstream; a bound on an unreported open call is plausibly upstreamable and no ask is prepared yet)

### acp: openings, native identity and custody
- `19c3eec8a`, `37bceecb9` · reject superseded asynchronous openings before spawn, and discard obsolete native replies before changing opening state · #32996 · upstream ask not written
- `0f5066257`, `ba2b264b8`, `e6d0fde75`, `710f46432` · publish selected child custody before initialize, clear the owned stat after a partial publication, with the catalog-exclusion and cleanup tests · #34599 · not upstreamable as written: the custody record is keyed on `HAB_ACP_PID_PREFIX`/`HAB_ACP_SESSION_URI`/`HAB_ACP_CHAT_URI`, which hab sets for the child it launches; the underlying early-publication bug is upstreamable against upstream's own identity
- `3400a70d0`, `1d14f2ce8`, `322b91d98`, `e5fb82b7a` · project only the current successful native chat identity, checkpoint it per start, and preserve identity capabilities and opening failures · #32996 · not upstreamable as written: same `HAB_ACP_*` protocol (`successfulOpening` absent upstream)
- `4ec4c8a2f` · retain shared capabilities with isolated launch options · #32996 · upstream ask not written
- `accd216d6`, `e9a357c66`, `109fb842c`, `11d020247` · a host-owned custody record kept through the child's end under one per-seat lock, carrying the verified host service identity · #34599 · not upstreamable as written: `HAB_ACP_*` lock and `HAB_ACP_HOST_SERVICE_IDENTITY`; the per-seat lock is hab's seat model
- not on main: `4ba34f69e`, awaiting its author's PR · the custody record carries `spawnedAt` and the spawning turn id from its `spawning` write through `ended`, so hab fences a hosted child's turn events without the file's mtime · #38456 · not upstreamable as written: same `HAB_ACP_*` custody record
- `9063cd7ae`, `0321cd8b1`, `ce669d44b` · retain inherited occurrence custody across host crashes, reject guard overrides and verify escaped child custody, and keep retained plugin resumes off probe authority · #34599 · not upstreamable as written: the spawn guard is `HAB_ACP_SPAWN_GUARD`, a hab-launched child protocol upstream does not have
- `861b34309` · pass the server's opening `_meta` through on the session state · #37272 · upstream ask not written (`openedMeta` absent upstream)
- `8d79ff977` · a session's summary says whether it was offered the host's tools, and why not, as `ahpd/hostTools` · #38499 · upstream ask not written (`ahpd/hostTools` absent upstream)

### acp / server: failure handling and retries
- `7ee8395a9`, `863a43a85` · preserve records read failures across open and watch, and keep unknown and spoken no-rollout errors · #35127 · upstream ask not written
- `920ffefcc` · recover only proven unspoken conversations before their first prompt · #35117 · upstream ask not written (`neverSpoken` absent upstream)
- `dec3c1424`, `64ddcd26b` · one bounded backoff policy for respawning a host server and for `failedOnHost` listings · #37753 · upstream ask not written

### acp: prompt and opening silence bounds
- `63213b86b`, `130b99603`, `84b2752b1` · a turn is the chat's running turn only once its prompt began; a server that never answers the handshake, `session/new`, `session/load` or `session/resume` fails its turn by name after `startAnswerMs` of silence (60 s; the clock restarts on every chunk) · #38705 · upstream ask not written (`startAnswerMs`, `promptBegun` absent upstream)
- `436268cd8`, `ff51a9ad7`, `ab776c51f`, `ddfddb621`, `54efa8483` · bound `session/prompt` too: a prompt the server goes quiet on ends its turn by name and frees the chat; no clock while the server waits on us or runs a tool it reported; ten times the bound once the prompt has begun to answer; a comment names the Gateway deadlines the bounds stay under (@dev/6, PR #73) · #38786 · upstream ask not written (no prompt bound upstream)

### Host: MCP server tokens and the pass-through
- `70d20178e`, `b2aa7a345` · a renewed MCP server token applies on arrival, and what a server took is recorded only once the reconnect that carries the token has taken · #38500 · PR pending card: text and tests ready on `upstream/38500-renewal-clean` = `fc8b490fa`, one commit over `upstream/main` `3bbd6d5f6` (was `f0e09da1c`), root `tsc` 29 lines unchanged and the two touched suites 10/10
- `429ab9a43`, `c09b3c80d` · an expired server token reads as that server's `authRequired` state (`Session.expired`), and stays `auth/required` on the session when the backend will not or cannot say it · #38500 · PR pending card: text and tests ready on `upstream/38500-expiry-state` = `e1a23f511`, stacked on the row above; root `tsc` 29 lines unchanged and the two touched suites 12/12
- `0dd84de8d`, `83c7da1b4`, `4d12e6f76` · one sdk builder for an MCP server's customization and id, and agent-acp publishes its configured MCP servers as customizations, so a targeted token can name one · #38500 · upstream ask not written (`mcpServerCustomization` absent upstream)
- `abfb33748`, `46fa719e9`, `41bf02a30` · a pass-through to an upstream MCP server on the tools listener (`openProxy`, `Start.proxyServer`), RFC 9728 `protectedResource` moved to the sdk with the named metadata URL, and agent-acp reaches configured HTTP MCP servers through it so a renewal arrives · #38500 · upstream ask not written (`openProxy` absent upstream)

### Host: plugin starts, plugin sessions and permission rules
- `e6dd2d9b5`, `d8b973dfc` · a start that skipped a plugin is written to `plugin-failures.json` beside `daemon.json`, which `ahpd doctor` and `ahpd status` report, with the plugin's credentials cleared from the line · #38645, #38646 · upstream ask not written (`plugin-failures.json` absent upstream)
- `b4bcefbca` · a plugin session without `close()` is logged once and treated as closed, so dispose and stop no longer break · #38506 · upstream ask not written
- `86d8dd111` · a permission rule that can match nothing (unparsable, or a bare MCP tool glob) is warned once by name · #38499 · upstream ask not written

### Plugins: channel operations
- `e0dab3d69`, `b30a23839` · a plugin's channel offers operations to `invokeOperation`, then brought in line with the reviewed upstream version · #38502 · posted https://github.com/ahpio/ahpd/pull/474 (upstream carries it as `e47b5f9cd`; ours differs by patch-id until a sync takes upstream's)
- `682418ef5` · `invokeOperation` tells a channel's `run` who sent the command (`caller: { client, owner }`) · #38277 · upstream ask not written (`OperationCaller` absent upstream)

### Records: exclusive creation
- `9b4d713d0`, `7c8074aeb`, `d7d038c2d` · arbitrate create-only record creation on disk with an exclusive lock, with the cross-process proof · #35139 · upstream ask not written (`tryAcquireFlock` absent upstream; upstream `createOnly` is an unrelated bot option)

### Plugins: service identity
- `88f113085`, `379acf190` · delegate plugin service identity to exact source bindings, and prove record refs cannot recover the startup credential · #35090 · not upstreamable: reads `HAB_ID_TOKEN_FILE`/`AHPD_SERVICE_TOKEN_FILE`, the token files hab writes; `serviceIdentityEnvironment` does not exist upstream

### Test infrastructure
- `0535e7929`, `bb37b23c8` · detect checkout Git mutations during ahpd tests, and isolate ahpd workspaces from ancestor Git discovery · #37182 · upstream ask not written (tests only; `AHPD_TEST_REPOSITORY` absent upstream)

### usage: inhab JSONL source
- `31d558b65`, `2a73aba1b`, `ab933f119`, `f3f3f3937`, `0ac4f15c2` · re-derive the usage JSONL append source from Ag (three provenance pins), preserve the zero-tail repair, and re-read the append boundary so a later record is never glued to a zero tail · #35067, #33944 · not upstreamable: reads hh's inhab JSONL journals and pins an Ag commit (`inhab-jsonl.provenance.json`), a format upstream does not have

### Host: a record's writes and a person's delegation
- `326837da6` (PR #22; hh/integration `6dc16d309`, `ef7eb440a`, `50af536bbc`, `25d15c7dec`, `d6e8b735d`, `7eb7aae9a`) · count every write on an agent record and let a write say which revision it read; keep the secrets a saved row shows; let a plugin write a `user:`-owned record only while that owner lists it in `delegates` on the record, keeping the owner, logged after the write lands · #38233 (@cto dea0a98b) · upstream ask not written (host-side owner rule and write count; no upstream issue names either)

### Services: machine-local switches
- `d82d697ed` (hh/integration `67799d139`) · `@ahpd/services` `machineSwitches(configDir)`: allowRemoteCommands and allowRoomAsks under a `machine` key in config.json that root config does not serve · #38277 (@cto 8033ccb4) · not upstreamable: the services package, now `@hallohuman/hightea-services`; upstream has no services package (ADR-004 amendment 6)
- `9b7bd1b3f` (hh/integration `1a7e8f52b`), `4027fc96d` (hh/integration `6e6f65762`) · `@ahpd/services` process-compose driver: `listServices`/`putService`/`removeService`/`controlService`/`serviceLogs`; last `-f` file only, sha256 ifVersion, range-splice edits, read-only rules, 0600 change log, reload over the Unix socket · #38277 slice 1 (@cto) · not upstreamable: same services package
- `178dc5f65` (hh/integration `163563a48`), `540754037` (hh/integration `54e5d3de0`), `54fa98c0c` (hh/integration `5ce94713c`), `acb6a760a` (hh/integration `849057267`), `fccbe345e` (hh/integration `076967b87`) · `@ahpd/services` as a plugin: `x-ahpd/services/{list,put,remove,start,stop,restart,logs}` under the `services` grants (every caller remote: a handler is told no transport), drift alerts `services-drift:<what>` at start and every 5 minutes (names process-compose holds vs the `-f` files, file sha256 vs the hash last written or acknowledged in `services/drift.json`), a person at the machine driving services in-process, acknowledge, backup and create-only restore · #38277 slice 2 (@cto) · not upstreamable: same services package (`540754037`'s six lines of `main.ts` only load it)
- `52344b179` (hh/integration `4791459b9`) · `ahpd secrets exec` in `packages/server` (`commands/secrets.ts`, read in `main.ts` before the program), the wrapper process-compose starts a program through: reads `vault.json` with no daemon, values only in the child's environment, a missing value starts nothing · #38277 slice 2 (@cto) · upstream ask not written (generic server command outside the services package; split from the services row on 2026-11-26)
- `d8f2ddd11` · `@ahpd/services` drift takes a replicated service (`replicas: N`, N ≥ 2) as its replicas `<name>-0` … `<name>-(N-1)`, the names process-compose 1.122.0 holds; `replicas: 1` keeps the plain name (probed), so only a missing or extra replica is drift · #38277 slice 4 (@cto 3f882428) · not upstreamable: same services package
- `ad91a9dd8` · `@ahpd/services` record equality: `same()` compares mapping keys in any order (arrays keep theirs), so an edit whose patch named a field before `name` is not refused as "did not read back as the record" · #38899 (@dev/luna6) · not upstreamable: same services package
- `d5f9e6e7d`, `0686aa13d` (merge `d2cc697a9`, PR #93) · `@ahpd/services` second driver: systemd --user units, as a `systemd-user` arm of `Machine`'s backend union beside `process-compose` (one `Driver` type, no SDK or registry); `put`, `start`/`stop` (`systemctl --user enable`/`disable --now`) and `remove`, other methods refused `NOT_SUPPORTED` by name; the customer install's Linux boot item is written, enabled, disabled and removed through it, so it is the one writer of user units · #38277 row 9 (@cto aaef896c, aed9c6e8) · not upstreamable: same services package

### Deploy: a customer host install and a git deploy driver
- `250b9a040`, `660c68dbd`, `e67e9ddc6`, `f4e97111d`, `b7f54963b`, `16fe9d2ed`, `1676d7a99`, `777d90ebe` · a customer host install manifest and plan, apply and uninstall from it, a step's exec modes, a resumable record, keep-vs-purge, named refusals for thrown effects, one `activateRelease` that journals the switch, an explicit install root so `$AHPD_HOME` is honoured, npm's own sha512 integrity beside sha256, and root tsc back to its 19-error baseline · #38280 (@dev/5) · not upstreamable: our customer-host install; upstream has no deploy package
- `dea9643b1`, `94828e260`, `902022937`, `8cec6324d`, `391703390` · a git deploy driver and the `ahpd deploy` verb: a step's own environment and timeout, gates before the switch, a lock that names its process, `started` answered only once the child holds the lock, the child stopped before refusing, and the driver served to a host as two AHP methods · #38276 (@dev/3) · not upstreamable: our deploy driver; upstream has no deploy package, and the `ahpd deploy` verb in `packages/server` only calls it
- `b8d267b10`, `e81d6a162`, `795e070de`, `6ecc1f9e2` · `ahpd-host-install`, the command the customer bootstrap runs: takes the pins file and plans, applies or uninstalls; runs through a symlink, needs a HOME, refuses unknown flags by name, prints a prune failure as a warning, and prepack bundles the bin after tsc so the tarball ships one runnable file · #38280 · not upstreamable: our customer-host install, run by Hightea's bootstrap
- `8d1b5829e`, `e5f55ea72`, `40f00c913` · the install writes the process-compose files its boot item runs (one per release, plus `state/services.yaml` seeded once) and ahpd's configuration as machine state at `state/config.json`, created once and kept across switches, with @cto's three S2 tests · #38277 S2 · not upstreamable: our customer-host install
- `2f7b635c7`, `21d3be851` · the deploy driver is one channel, `x-hh-deploys://`, with one `deploy` operation run by `invokeOperation`; the old methods refuse naming it; the read grant is `deploy:status`, since `read` is reserved · #38276 · not upstreamable: speaks our `x-hh-deploys://` channel, named for its owner (ADR-004 amendment 6)
- `d7985cfe8` · the deploy declaration lives on the service's own record (`x-hh-deploy`), so `deploy` takes only `{service, version}` and a caller can no longer supply commands · #38549 · not upstreamable: reads the hightea-services record
- `2170549e0`, `9fd9a4255` · when the child wins the lock after the last check, the refusal names the lock and the journal says outcome unknown, not not-started · #38276 · not upstreamable: same deploy driver
- `b68ba4282`, `455a7b859` · an unreadable services listing is a channel state and a named refusal, not a throw; a wrong deploy block is named as the deploy plugin's, not the services entry beside it · #38276, #38645 · not upstreamable: same deploy driver
- `cdd290be5` · journal every release a prune removes · no issue in the commit (its PR branch names #38276) · not upstreamable: same deploy driver

### Deploy: release archive, prune and switch-back
- `c5f4384fd`, `21ab868e6`, `a8ba70228`, `4be215e82`, `40af6685d`, `8fcb4979a`, `b585d7651` · a newer version is a switch through `activateRelease`, pruned by one shared rule (`releasesToPrune`); prune only after a started release, recorded first; a failed start switches back and says so if that fails too; a folder that will not delete stops the prune by name; the release a switch left is kept as the way back, and a switch back is a journal flag (`back: true`), never the prune target · #38280 · not upstreamable: our customer-host install and deploy journal
- `291ba3c07`, `1496e7f84`, `9328439a8`, `d140757fc`, `028f9a360`, `4c7f82ac1`, `5bd565ed6` · the daemon arrives as one pinned archive, checked entry by entry before unpacking (read with node-tar, the safety policy ours): each link resolved from its own base, none re-entering the stripped top folder, strict extraction, a leftover staging tree refused and cleared by its own install; uninstall unlinks `current` instead of rmdir through it; docs name the pins file · #38280 · not upstreamable: our customer-host install

### Host build: customer-host release assets
- `15409ac82`, `719a45ea5`, `c3ada8fd0`, `64fffc3e8`, `72668b3b8` · `scripts/pack-host-archive.mjs` packs the reproducible daemon archive for one platform, top folder named after the archive, a required https `--source-base`, any type error refusing the release, and `--pin-base` writing the complete four-pin `pins-<platform>-<arch>.json` · #38280 · not upstreamable: builds our customer-host release assets
- `bc6890fd4` · a darwin-x64 host release target: the builder takes its bun archive by platform and arch instead of hard-coding macOS to aarch64 and no longer refuses an Intel Mac; finalize accepts a third target's pins; the deploy CLI's refusal names all three targets · #38280 (@dev/5) · not upstreamable: builds and publishes our customer-host release assets
- `5ec582a31` · `scripts/tar-writer.mjs`: the host archive is written in plain Node/Bun with a fixed order, mtime and zero ownership, so a machine with only Bun cuts its half of a release (no GNU tar, no gzip binary, no pnpm install); pnpm steps fall back to bunx at the pinned version; a test reads the archive back with node-tar, the installer's own reader · #38280 (@dev/5) · not upstreamable: builds and publishes our customer-host release assets
- `da1bea42d`, `da5b032ca`, `54301716e`, `be078ac43`, `d0196f4a2`, `7a99b3ce9` · `scripts/build-host-release.mjs` builds the six customer-host release assets (draft, append, finalize across two machines), holds their names in a test, runs the packed deploy before uploading, and the boot item's supervisor flags and quoting; docs say what a one-machine release means on the other machine · no issue in the commits (their branches name #38280) · not upstreamable: builds and publishes our customer-host release assets
- `153edb33c` · `tsconfig.base.json` loads only Node's global types (`types: ["node"]`, plus `es2024.promise`), so the build no longer depends on the folder above the checkout · #38280 · upstream ask not written (neither setting is upstream)

### Host: plugin grants reach every path
- `fe791140b`, `2c18ddc14`, `e838dfb01`, `3a38b2fa6`, `68a74eee8`, `dcc52429c`, `a58415897`, `bdf1b98bb` · every grant refusal logged once at the boundary, `-32009` logged once rather than at four sites, one `heldToGrants` check plus four more paths a plugin skipped its grants with no users directory, a plugin's own connection held to its entry's grants, a refusal line escaping what the caller chose with capped windows, a transcript excerpt left off for `session:read` logged once, and a `host.connect()` connection always carrying `principal.plugin` · #38446 (@cto rulings; PRs #8-#11) · upstream ask not written (host-side grant enforcement)
- `523f50534`, `e42b06de9` · the users-read census runs git through `gitSync` and counts copies of a line, so a fourth identical read is not lost · #38446 · not upstreamable: the census is our own test harness
- `ff37e12a2` · the plugins contracts table names grants · #38446 prior art (PR #9) · upstream ask not written (a generic docs table)

### Services: the grants its manifest applies
- `eac0dabf0`, `31e23c05d` · the services manifest declares the grants `apply()` registers, and a test proves no daemon method, plugin hook or pipe path reaches `localServices` · #38277 · not upstreamable: same services package

### Services: the x-hh-services channel, its owner field and its alerts
- `05f15b6f6`, `4b87c342c` · the services driver becomes the `x-hh-services://` channel, whose actions are its operations, and the package is published as `@hallohuman/hightea-services` · #38277 · not upstreamable: `@hallohuman/hightea-services` is a Hightea package that leaves this repo with the deploy plugin (ADR-004 amendment 6)
- `3548ee7cc` · a service says who put it on the machine, as `source` (`x-hh-source`) · #38278 · not upstreamable: same Hightea package
- `8c521d5d1` · alert when process-compose gives up on a program (`services-gave-up:<name>`), and make read-only a command YAML cuts at ` #` · #38120 · not upstreamable: same Hightea package

### Our own process docs
- `c17289eb2`, `4c403b657` · every upstream post gets `/pro` and an independent Fable critique first, and prior art is checked before any ahpd change · #38236 · not upstreamable: our review process
- `594b14cc8` · this file moves to `main`, since `main` is the release line · #463 · not upstreamable: the fork's own ledger
- `f79cad01a`, `0cbb6e169` · the first #38436 pass rows 29 unrowed patches, and names where the #38233 row and its fixups landed · #38436 · not upstreamable: the fork's own ledger
- `463beda51` · an upstream post leaves out how our work is made (no review process, models, agents, seats or beads) · no issue (operator rule 2026-11-25) · not upstreamable: our own posting rule
- `b16e4361e`, `3ab1bedf2` (hh/integration `51ada35c0`, `c85cf2030`) · the fork release packs with `scripts/pack-fork-release.mjs`: every packed manifest is stamped to `<x.y.z>-<suffix>` before anything is packed (a sibling's `workspace:*` resolves from its manifest, so one-at-a-time stamping shipped deploy naming an unstamped services), every manifest is restored in one `finally` even when a refusal unwinds through it, and each tarball's sibling dependencies and the lock's importer entries are read back and refused unless they name the packed version · #38983 (@cto a76b1ed6, fd4b9906; @dev/6 review) · not upstreamable: the fork's own release step
- `51ada35c0`, `c85cf2030` · the fork release packs with `scripts/pack-fork-release.mjs`: every packed manifest is stamped to `<x.y.z>-<suffix>` before anything is packed (a sibling's `workspace:*` resolves from its manifest, so one-at-a-time stamping shipped deploy naming an unstamped services), every manifest is restored in one `finally` even when a refusal unwinds through it, and each tarball's sibling dependencies and the lock's importer entries are read back and refused unless they name the packed version · #38983 (@cto a76b1ed6, fd4b9906; @dev/6 review) · not upstreamable: the fork's own release step

### Rebase repairs and test-only fixups
- `dae7f13d4` (PR #24; hh/integration `173a6ff76`, `c24cccacf`) · `@bearly/durable-file` from the registry, and each plugin-route daemon with its own `XDG_CONFIG_HOME` so the store's one-writer fence does not refuse the other three · #38185 · upstream ask not written (test-only; the durable-file change is a rebase repair named under Rebase below)

### Superseded
- `d17130bbf` · remove per-turn git checkpoint capture, keeping `removeCheckpoints` · #35139 (@cto ruling C 1e5710d0) · superseded by `535303cf5` (#38158, PR pending card: an unreferenced in-memory baseline tree; no baseline reads unknown, never 0); not on main: `535303cf5`, awaiting its author's PR. Upstream's test "shows a file a shell command wrote in the session's own changeset" (packages/sdk/test/changes-refresh.test.ts) needs these checkpoints and is skipped on `main` with this reason (#463 sync, `0f92e1c41`), so the next sync shows it again

## PR prepared (not carried)

Upstream fixes written straight against `upstream/main` and never carried on `hh/integration`. They
are not in the patch count. None is waiting now.

- `92afb94db` on `fix/acp-backend-start-fails-creation` (base `upstream/main` `7d927326c`) · a
  backend that cannot start fails session creation: opt-in `Session.sendBringsUp`, agent-acp's send
  resolves once its server holds the session and rejects naming the command, its PATH and a capped
  stderr tail · #38139 (@cto b1d6a0cf, amendment OK 491ba7d9) · posted
  https://github.com/ahpio/ahpd/pull/463 (merged 2026-11-25; `sendBringsUp` is on `upstream/main`)

## What is left on the zero-patch target

Measured 2026-11-26 (@dev/4, #38436) over the 190 commits `main` (`7b49d0cbb`) carries over `upstream/main`
(`1f3168c22`), counting each commit under its row's upstream status (a row naming a PR merge commit counts that
merge's `^1..^2` commits):

- 89 are absent upstream with no ask written — the real remaining work on the zero-patch target;
- 97 are not upstreamable: 17 speak hab's `HAB_ACP_*` / `HAB_ID_TOKEN_FILE` child protocol, 5 read hh's inhab JSONL
  journals pinned to an Ag commit, 53 are our customer-host install, deploy driver and release builder, 14 are the
  `@hallohuman/hightea-services` package, 2 are the users-read census harness, and 6 are our own process docs and
  this ledger (the older deploy and services rows moved here from `upstream ask not written` on 2026-11-26, @cto
  f8fac5d6: upstream has no deploy or services package, and their channels are ours by ADR-004 amendment 6;
  `ahpd secrets exec`, generic server code, stays an ask in its own row);
- 2 are posted (plugin channel operations, ahpio/ahpd#474): upstream carries its own version, so they leave the
  count when a sync takes upstream's;
- 2 are superseded (`d17130bbf` and the test skip `0f92e1c41` it needs), replaced by #38158's `535303cf5`, which is
  not on `main` yet.

Not counted, because not on `main`: `c6f74e9d0` (#38159; ahpio/ahpd#462 was closed unmerged on 2026-11-24) and
`535303cf5`. The one PR prepared (#38139) was posted and merged upstream (ahpio/ahpd#463, 2026-11-25), so none is
waiting.

The honest shape of the target is therefore: 89 upstream asks, and a decision on the 17 hab-protocol patches, which
stay ours unless upstream grows hab's protocol. The other 80 fork-only commits are ours by nature.
