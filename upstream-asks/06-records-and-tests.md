# Upstream asks — records and tests

**Draft only.** Posting is gated on one operator card covering every batch; nothing here is posted.

2 issues / 5 patches. Base: `upstream/main` `41dcfaa0b`; each patch series is in `patches/<slug>.patch`.

## Records cannot be created exclusively, so concurrent creators overwrite each other

**Patch:** `patches/records-exclusive-create-only.patch` (3 commits: 9b4d713d, 7c8074ae, d7d038c2)

**What happens today.** `RecordCollection.put` always replaces what its id holds, in memory and on disk. No writer can say "create this key or fail": the file store renames a temporary over the target, so two processes creating the same id both succeed and the second wins. Upstream's `createOnly` is the unrelated bot/computer resource-write option in `packages/bot/src/commands.ts`.

**What the patch does.** Adds `{ createOnly?: boolean }` to `RecordCollection.put`, forwarded by the plugin host; `memoryRecords` refuses an existing id with `RpcError(-32010)`, the code the bot path already uses. The file store publishes through `atomicPublishFileSync` from `@bearly/durable-file`; the loser rereads the winner before refusing, and throws if it has vanished rather than claiming an unproven conflict.

**Evidence.** `packages/sdk/test/plugin-records.test.ts` `create-only records retain one winner through plugin=%s` (also proving the plugin path does not drop the option); `packages/server/test/records.test.ts` `create-only file records refresh the actual winner after a stale-cache conflict` and `create-only file records elect one independent process and refresh the losing process`, which forks two writers and requires one `created` and one `conflict` on the same record.

**For review.** Touches `packages/sdk/src/{types/records,resources/records,plugins/plugins}.ts`, `packages/server/src/records.ts`, both record tests and four manifests. The dependency is a GitHub tarball pinned to a commit in a `bearly` fork, plus an `overrides` pin of `@bearly/flock`; upstream has no `tryAcquireFlock` equivalent, so it needs a decision. `tsdown` in the root `package.json` looks unrelated.

## A test run can mutate the checkout's Git state and cannot detect it

**Patch:** `patches/tests-git-mutation-isolation.patch` (2 commits: 0535e792, bb37b23c)

**What happens today.** `tools/test-tmpdir.ts` is the vitest global setup: it makes one temp folder per run, points `TMPDIR`/`TEMP`/`TMP` at it, and checks for state written into the repository. It never looks at Git, so a test that creates a ref, moves `HEAD` or stages a file leaves the checkout changed. Two filesystem suites read fixtures from the real checkout and `nested-process.test.ts` runs `ahpd` against it, so a temp folder inside a checkout can discover the repository above it.

**What the patch does.** Snapshots `refs`, `HEAD` and the index, compares them after cleanup, and throws `a test changed checkout Git ...`; no `.git` means skipped. Sets `GIT_CEILING_DIRECTORIES` to the run folder and builds a small temporary repository of the suites' fixtures, exposed as `AHPD_TEST_REPOSITORY`; they and the nested child serve it.

**Evidence.** `packages/sdk/test/test-git.test.ts` `checks checkout %s after a test run` and `keeps a temporary non-repository from discovering the repository above the run`; `packages/sdk/test/support/work.ts` throws when `AHPD_TEST_REPOSITORY` is unset. With the setup change reverted, the mutating cases pass silently.

**For review.** Touches `tools/test-tmpdir.ts` and five `packages/sdk/test/` files. Snapshots bracket the run's own cleanup, so a mutation during cleanup is unseen, and a throw can mask the run's real failures. The fixture copy list is hard-coded and will drift if those suites read another path. `setup(project)` relies on vitest passing the resolved config.
