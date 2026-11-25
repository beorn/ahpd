# ahpd — agent pre-flight

## Before any change: the prior-art check (standing rule, operator 2026-11-24)

No ahpd change is built or posted until its author has written a short prior-art note, in the change itself (PR body, commit message, or the bead it serves), covering all three:

1. **The standards.** What the AHP standard says about this area, and what the ACP spec says. Cite the section or the wire field, not a paraphrase.
2. **Prior art in clients.** How VS Code handles it, how Zed handles it, and how at least one other client handles it. Name the file or behaviour you read.
3. **New abstractions named.** Every new abstraction, type, or protocol field the change introduces, each with why the spec and the existing primitives in this repo do not already cover it. A new abstraction with no answer here does not land.

If the note shows the spec or an existing primitive already covers the case, use that instead of building the new thing. The check exists because a change that smells of over-engineering usually has its answer in the standard or in a client that already solved it.

## Where things live

- Keeping up with VS Code's reference host: [UPSTREAM.md](UPSTREAM.md) and [REFERENCE.md](REFERENCE.md). A prior-art pass follows that procedure.
- Developing and testing: [DEVELOPER.md](DEVELOPER.md).
