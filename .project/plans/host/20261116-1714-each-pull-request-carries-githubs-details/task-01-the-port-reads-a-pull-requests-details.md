---
title: The port reads a pull request's details
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/github.ts#L6-L15](../../../../packages/sdk/src/types/github.ts#L6-L15) - `PullRequest`, which gains the details"
  - "[code://packages/sdk/src/repo/github.ts#L90-L131](../../../../packages/sdk/src/repo/github.ts#L90-L131) - the lists by branch, over REST and `gh pr list`"
  - "[code://packages/sdk/src/repo/github.ts#L143-L184](../../../../packages/sdk/src/repo/github.ts#L143-L184) - `byUrl`, over REST and `gh pr view`"
  - "[code://packages/sdk/src/repo/github.ts#L277-L295](../../../../packages/sdk/src/repo/github.ts#L277-L295) - `coreIn`, which reads the same REST answer for the agent merge"
  - "[code://packages/sdk/test/github.test.ts](../../../../packages/sdk/test/github.test.ts) - the port's cases"
---

## Objective

`forBranch` and `byUrl` answer each pull request with what GitHub says of it, over REST and over `gh`.

## Files

- `UPDATE: packages/sdk/src/types/github.ts:6-15` - `PullRequest` gains optional `number`, `body`, `isDraft`, `author`, `baseRef`, `headRef`, `updatedAt`, `mergedAt` and `closedAt`.
- `UPDATE: packages/sdk/src/repo/github.ts:90-184` - both lists and both single reads map the details.
- `UPDATE: packages/sdk/test/github.test.ts` - the cases read the details over REST and over `gh`.

## Steps

1. Add the optional fields to `PullRequest`, each with a one-line doc comment, named as VS Code's `IGitHubPullRequest` names them.
2. Type `author` as `{ login: string; avatarUrl?: string }`.
3. Write `detailsOfRest(item)` to map `number`, `body`, `draft`, `user.login`, `user.avatar_url`, `base.ref`, `head.ref` and the five dates.
4. Use `detailsOfRest` in `byApi` and in `oneByApi`, beside the state and title they map today.
5. Write one function `detailsOfGh(item)` that maps `gh` names: `number`, `body`, `isDraft`, `author.login`, `baseRefName`, `headRefName`, `createdAt`, `updatedAt`, `mergedAt`, `closedAt`.
6. Ask `gh pr list` and `gh pr view` for those fields by name in `--json`.
7. Use `detailsOfGh` in `byGh` and in `oneByGh`.
8. Leave out a field that GitHub did not send; send no empty string in its place.

## Validation

- `packages/sdk/test/github.test.ts`: "reads a pull request's details over the API", for a list and for one page.
- `packages/sdk/test/github.test.ts`: "reads a pull request's details from gh", for `gh pr list` and `gh pr view`.
- `packages/sdk/test/github.test.ts`: "answers a pull request with no details where GitHub sent none".
- `pnpm typecheck` passes.

## Resume

Built on 2026-11-16, awaiting review.

- `PullRequestAuthor` is a type of its own, exported beside `PullRequest`.
- `gh` sends `null` for a date that has not happened, checked on 2026-11-16 with `gh pr view`; the mapping leaves it out.
- The four cases that held the old answers and the old `--json` list now hold the details.

