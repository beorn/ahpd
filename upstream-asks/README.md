# Upstream asks for the carried patches

One issue draft per carried patch group, so the zero-patch target is a thing we can post rather than
a number we quote. **Nothing here is posted.** Posting waits on one operator upstream card covering
every batch (@cto ruling 2026-11-24, `ac13954a`); no batch goes out before that card, and none goes
out alone.

Counted from the 70-patch census (`../FORK-PATCHES.md`): **70 carried · 46 asks to post · 22 retire
with hab · 1 PR prepared · 1 superseded.** One correction to the 46: `84441da3c` is `2ab6dcb47`
replayed by a rebase, so the 46 patches are 45 distinct changes and batch 02 carries that change
once. The number stays 46 because it is a commit count over `hh/integration`, and the census counts
commits.

## Batches

| batch | package area | issues | patches | file |
|---|---|---|---|---|
| 01 | host session store, owned creation, reservations | 4 | 9 | `01-host-session-store.md` |
| 02 | host chat binding and conversation provenance | 2 | 7 | `02-host-chat-binding.md` |
| 03 | host prompt settlement, sleep, close | 5 | 8 | `03-host-prompt-sleep-close.md` |
| 04 | host turn ids, join scope, catalogue, store writers | 5 | 8 | `04-host-turn-join-catalogue.md` |
| 05 | ACP openings, records failures, server retry | 6 | 9 | `05-acp-and-server.md` |
| 06 | records exclusive creation, test infrastructure | 2 | 5 | `06-records-and-tests.md` |

24 issues, 46 patches. Each issue names the patch series in `patches/<slug>.patch` (a
`git format-patch` series against `upstream/main` `41dcfaa0b`), the tests that prove it, and the
files it touches.

Of the 24, **22 post as issues and 2 are AHP schema proposals first** — `host-turn-id-fence`
(`turnId` on `chat/inputRequested`) and `acp-opening-meta-session-state` (`_meta` on the opening
reply). Both are marked **waits on protocol** in their batch files and stay fork patches until the
schema is accepted (@cto, 2026-11-24).

## Before posting a batch

1. **Rebase the series onto current `upstream/main`.** These were cut against `41dcfaa0b`; the fork
   is 436 commits behind, so expect context drift and, in `host-session-store` and
   `host-turn-join-catalogue`, a rewritten neighbour block.
2. **Drop fork policy.** `host-fence-file-store-writers` carries `package.json` `os`/`engines`
   narrowing and README edits that are ours, not upstream's; the issue says so. Post the lock and
   the `owned()` checks, never the manifests.
3. **Keep the order the issues name** where one stacks on another (02's provenance needs 02's
   binding; 03's close-release needs 04's writer fence).
4. **One issue per change**, with the series attached or linked — not one PR mixing packages.
5. **Re-check the "absent upstream" claim** for the file you are about to post: the census measured
   absence by patch id and by distinctive identifier, not by reading every file.
6. **Re-check a dependency before it posts.** `records-exclusive-create-only` publishes through
   `atomicPublishFileSync` from `@bearly/durable-file`; 0.2.0 is published and npm `latest` as of
   2026-11-24, so the issue names it. If it is ever unpublished or unreachable at posting time, hold
   that one issue, not the batch — and check `npm view @bearly/durable-file dist-tags` first.

## What is not here

- The 22 patches that speak hab's `HAB_ACP_*` / `HAB_ID_TOKEN_FILE` child protocol and the five that
  read the Ag-pinned inhab JSONL journals **retire with hab**; no ask is written for them
  (@cto 2026-11-24). They are listed, with reasons, in `../FORK-PATCHES.md`.
- The one patch with upstream text already prepared ships under its own card (see `../FORK-PATCHES.md`
  § Superseded / PR pending card).
