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
