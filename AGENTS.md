# ahpd — agent pre-flight

## Before any change: the prior-art check (standing rule, operator 2026-11-24)

No ahpd change is built or posted until its author has written a short prior-art note, in the change itself (PR body, commit message, or the bead it serves), covering all three:

1. **The standards.** What the AHP standard says about this area, and what the ACP spec says. Cite the section or the wire field, not a paraphrase.
2. **Prior art in clients.** How VS Code handles it, how Zed handles it, and how at least one other client handles it. Name the file or behaviour you read.
3. **New abstractions named.** Every new abstraction, type, or protocol field the change introduces, each with why the spec and the existing primitives in this repo do not already cover it. A new abstraction with no answer here does not land.

If the note shows the spec or an existing primitive already covers the case, use that instead of building the new thing. The check exists because a change that smells of over-engineering usually has its answer in the standard or in a client that already solved it.

## Before any upstream post: two reviews (standing rule, operator 2026-11-24)

Nothing goes to upstream ahpd (ahpio/ahpd: a PR, a pushed commit, an issue, or a review comment) until it has had both of these reviews, and every finding is fixed or answered in the post. This applies to every post, not only batches: #463 skipped both because it went up outside the batch flow.

1. **A `/pro` review** of the exact diff being posted.
2. **An independent critique by a Fable-model reviewer.** It gets the same diff and prompt, and reads no other review first.

Record both verdicts, with the head sha each one read, on the bead the post serves. A head that changes after review is reviewed again. Posting itself still needs the operator's yes, unless a standing yes covers that kind of post.

## What an upstream post leaves out (operator 2026-11-25)

How our work is made stays behind the scenes. A post upstream (PR description, commit message, issue, or comment) never mentions our review process, how many reviews something went through, which models or agents worked on it, or our seats and beads. Say what the change does and why; the reviews above are recorded on our own bead, not in the post.

## Where things live

- Keeping up with VS Code's reference host: [UPSTREAM.md](UPSTREAM.md) and [REFERENCE.md](REFERENCE.md). A prior-art pass follows that procedure.
- Developing and testing: [DEVELOPER.md](DEVELOPER.md).
- What this fork carries over upstream: [FORK-PATCHES.md](FORK-PATCHES.md). A carried change adds its FORK-PATCHES.md row in the same PR (one row per patch; see the file's header).

## Before running the suites: unset `AHPD_PLUGIN_ROOT`

A seat harness on this host exports `AHPD_PLUGIN_ROOT` pointing at a trial install. Every install and update case that expects to write into its own temporary root then writes somewhere else, and
`packages/server/test/server-http.test.ts` and its neighbours fail with `400 where 200 was expected` — a red that looks like a product bug and is not. Run the suites as
`env -u AHPD_PLUGIN_ROOT npx vitest run <paths>`; two review passes were lost to this before it was found (2026-11-25).

## In a fresh worktree: build `packages/sdk` and write the schema first

Two reds in a new worktree look like product bugs and are not:

- `Cannot find module '@ahpd/sdk'`, from a custody fixture's child process, because that process resolves the package
  rather than its `src`. Build it once: `pnpm exec tsc -p packages/sdk`.
- Five failures in `packages/agent-acp/test/agent-acp-ports.test.ts` reading the strict schema, because `tools/schema.mjs`
  has not written it. Run `node tools/schema.mjs`; the repo's own `test` script does this first for that reason.

Found on 2026-11-25 while reviewing #56; `node tools/schema.mjs && npx vitest run packages/agent-acp` is green after both.
