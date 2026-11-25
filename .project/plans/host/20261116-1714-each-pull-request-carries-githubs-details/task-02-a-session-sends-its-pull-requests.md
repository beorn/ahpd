---
title: A session sends what GitHub says of each of its pull requests
status: done
depends: [task-01-the-port-reads-a-pull-requests-details.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/facts.ts#L106-L186](../../../../packages/sdk/src/host/facts.ts#L106-L186) - `metaOf`, which gains the `ahpd.pullRequests` key"
  - "[code://packages/sdk/src/host/facts.ts#L598-L670](../../../../packages/sdk/src/host/facts.ts#L598-L670) - `refreshPullRequests`, which gains the read of each session URL"
  - "[code://packages/sdk/src/host/facts.ts#L623-L626](../../../../packages/sdk/src/host/facts.ts#L623-L626) - `candidatesOf`, the recorded and associated URLs, to be shared by both paths"
  - "[code://packages/sdk/test/host-github.test.ts](../../../../packages/sdk/test/host-github.test.ts) - the session's GitHub facts cases"
---

## Objective

Each session's `_meta['ahpd.pullRequests']` holds what GitHub says of each pull request the session shows, keyed by its URL.
A recorded pull request on another branch shows merged once GitHub says it is merged, with `autoAttachPullRequests` on or off.

## Files

- `UPDATE: packages/sdk/src/host/facts.ts:106-186` - `metaOf` adds `ahpd.pullRequests` with the session's own entries.
- `UPDATE: packages/sdk/src/host/facts.ts:598-670` - `refreshPullRequests` reads each session URL by `byUrl` and holds the details.
- `UPDATE: packages/sdk/test/host-github.test.ts` - the cases of the new key.

## Steps

1. Add a map `details`, from a directory to a map from `urlKey(url)` to the `PullRequest` GitHub last answered.
2. Move `candidatesOf` out of the `autoAttachPullRequests === false` branch, so both paths use it.
3. Write `sessionUrls(uri)`: the directory's `pullRequestUrls`, then `candidatesOf(uri)`, each once by `urlKey`, ten at most.
4. Hold each pull request that `forBranch` or the branch's `byUrl` answered in `details`.
5. After the branch read, in both paths, call `byUrl` for each session URL of the directory.
6. Skip a URL that `details` holds as merged.
7. Skip a URL that the branch read of this pass answered.
8. When one read fails, keep the held entry and log the error as the branch read does.
9. Go on with the next URL after a failed read.
10. Return `true` from `refreshPullRequests` when any held entry changed, so `metaChanged(dir)` runs once.
11. In `metaOf`, put `ahpd.pullRequests` with an entry for each URL of `sessionUrls(uri)` that `details` holds.
12. Cut `body` at 1000 characters, and set `bodyTruncated: true` on an entry whose body was cut.
13. Send no `ahpd.pullRequests` key for a session with no held entry.
14. Delete the directory's `details` entry in the same place that deletes its `githubFacts` entry.

## Validation

- `packages/sdk/test/host-github.test.ts`: "sends the branch's pull request with what GitHub says of it".
- `packages/sdk/test/host-github.test.ts`: "reads a recorded pull request of another branch, and shows it merged once GitHub says so".
- `packages/sdk/test/host-github.test.ts`: "reads the recorded and associated ones with automatic attachment off, and associates nothing new".
- `packages/sdk/test/host-github.test.ts`: "does not read a merged pull request again".
- `packages/sdk/test/host-github.test.ts`: "keeps what it held when GitHub does not answer for one".
- `packages/sdk/test/host-github.test.ts`: "sends a session only its own pull requests, not another session's in the same folder".
- `packages/sdk/test/host-github.test.ts`: "cuts a long description and says so".
- The existing cases of `host-github.test.ts` pass unchanged: `_meta.github` keeps its keys.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- `candidatesOf` moved to the top of `createFacts`.
- `readDetails` reads the session URLs after the branch read in every path, also after a failed one.
- The key is `PULL_REQUESTS_META`, exported from `host/facts.ts`.
- A case first read the folder before the setting arrived, so the case with automatic attachment off checks that nothing is listed after the setting.
- The 25 cases that were there pass unchanged.

