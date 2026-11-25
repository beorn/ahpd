---
title: The docs and the spec name a pull request's details
status: done
depends: [task-02-a-session-sends-its-pull-requests.md]
layer: "docs"
refs:
  - "[code://docs/sdk/SESSIONS.md](../../../../docs/sdk/SESSIONS.md) - a session's `_meta` keys"
  - "[code://.project/specs/git-and-changes.md](../../../../.project/specs/git-and-changes.md) - the session's GitHub facts, as scenarios"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the 0.15 release notes"
---

## Objective

A client author reads what `ahpd.pullRequests` holds and when it moves, and the release notes say it.

## Files

- `UPDATE: docs/sdk/SESSIONS.md` - a section on `ahpd.pullRequests`: its fields, the 1000-character cut, when it is read and polled.
- `UPDATE: .project/specs/git-and-changes.md` - a scenario for a recorded pull request's details, and one for the poll.
- `UPDATE: docs/updates/v0_15.md` - one line: each pull request of a session carries what GitHub says of it.

## Steps

1. Write the `SESSIONS.md` section with a table of the fields, named as `PullRequest` names them.
2. Say there that `_meta.github` stays as VS Code's host writes it.
3. Add the two scenarios to the spec in its WHEN, THEN and AND form.
4. Add the line to the release notes under the unreleased section.
5. Run `node ~/.claude/skills/do-spec/scripts/lint-prose.mjs` on the spec.
6. Run `pnpm build` and the docs build.

## Validation

- The docs build passes.
- `lint-prose.mjs` passes on `.project/specs/git-and-changes.md`.

## Resume

Built on 2026-11-16, awaiting review.

- The section is *Pull requests* in `docs/sdk/SESSIONS.md`, and the release note sits under a new *Sessions* heading of 0.15.0.
- `pnpm docs:build` passes after `pnpm build`.

